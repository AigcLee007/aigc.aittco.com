import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set, keys } from 'idb-keyval';
import { imageResultStore as store, createImageResultStore } from './imageResultStore';

const original=()=>new Blob(['original'],{type:'image/png'});
const preview=()=>new Blob(['preview'],{type:'image/webp'});
beforeEach(async()=>{vi.stubGlobal('Blob',NodeBlob);await clear();localStorage.clear();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('shared result storage',()=>{
  it('never persists raw image bytes or truncated addresses as URL aliases',async()=>{
    const raw='/9j/'+ 'A'.repeat(200000);
    const {id}=await store.register({ownerId:'a',jobId:'invalid-source',originalUrl:raw,previewUrl:'/preview.webp'});
    expect((await keys()).filter(key=>String(key).length>4096).length).toBe(0);
    expect(await store.find('a',raw)).toBeUndefined();
    expect((await store.getState(id)).originalUrl).toBeUndefined();
    expect((await store.find('a','/preview.webp'))?.id).toBe(id);
    await store.register({ownerId:'a',jobId:'invalid-source',originalUrl:'data:image/png;base64,abc[truncated]'});
    expect((await store.getState(id)).originalUrl).toBeUndefined();
  });
  it('prunes only oversized legacy aliases and retains original bytes, previews and records',async()=>{
    const hugeKey='result-source-a-%2F9j%2F'+'A'.repeat(200000);
    await set(hugeKey,'legacy-result');
    await set('asset-legacy',original());await set('asset-preview-legacy',preview());
    await set('infinitemuse-history',JSON.stringify({state:{logs:[{id:'keep'}]}}));
    const fresh=createImageResultStore();
    try {
      await fresh.register({ownerId:'a',jobId:'after-upgrade',originalUrl:'/valid.png'});
      expect(await get(hugeKey)).toBeUndefined();
      expect(await get('asset-legacy')).toBeTruthy();expect(await get('asset-preview-legacy')).toBeTruthy();
      expect(await get('infinitemuse-history')).toContain('keep');
      expect(await fresh.find('a','/valid.png')).toBeTruthy();
    } finally {fresh.close();}
  });
  it('retains a valid original URL and committed bytes when a later source is malformed',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'keep-original',originalUrl:'/valid.png'});
    await store.putOriginal(id,original());
    await store.register({ownerId:'a',jobId:'keep-original',originalUrl:'/9j/'+'A'.repeat(1000)});
    expect(await store.getState(id)).toMatchObject({originalUrl:'/valid.png',originalCached:true});
  });
  it('reads committed originals and previews in a new connection the next day after cloud expiry',async()=>{
    const now=Date.now();
    const {id}=await store.register({ownerId:'a',jobId:'next-day',originalUrl:'/temporary.png',cloudBacked:true,cloudExpiresAt:now+4*3600000});
    await store.putOriginal(id,original());await store.putPreview(id,preview(),{previewVersion:1});
    vi.spyOn(Date,'now').mockReturnValue(now+24*3600000);
    const nextDay=createImageResultStore();
    try {
      expect(await nextDay.getState(id)).toMatchObject({originalCached:true,previewCached:true});
      expect(await nextDay.getOriginal(id)).toBeTruthy();expect(await nextDay.getPreview(id)).toBeTruthy();
    }finally{nextDay.close();}
  });
  it('keeps download invocation separate from durable image availability',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'download-only'});
    const token=await store.claimDownload(id);await store.markDownloadStarted(id,token!);
    expect(await store.getState(id)).toMatchObject({downloadState:'started',originalCached:false,previewCached:false});
  });
  it('retains owner/job/output identity and both aliases when a result URL changes',async()=>{
    const a=await store.register({ownerId:'a',jobId:'job-1',outputIndex:0,originalUrl:'/provider'});
    const b=await store.register({ownerId:'a',jobId:'job-1',outputIndex:0,originalUrl:'/site'});
    expect(a.id).toBe(b.id);expect((await store.find('a','/provider'))?.id).toBe(a.id);
    expect((await store.find('a','/site'))?.id).toBe(a.id);
    expect(await store.find('b','/site')).toBeUndefined();
    expect(store.resultId('a','job-1',1)).not.toBe(a.id);
    expect(store.resultId('a:x','job',0)).not.toBe(store.resultId('a','x:job',0));
  });
  it('reports durable preview and original independently after transactions commit',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'preview-only'});
    await store.putPreview(id,preview(),{width:720,height:405,previewVersion:1});
    expect(await store.getState(id)).toMatchObject({originalCached:false,previewCached:true,width:720,height:405,previewVersion:1});
    expect(await store.getOriginal(id)).toBeUndefined();
    await store.putOriginal(id,original());
    expect(await store.getState(id)).toMatchObject({originalCached:true,previewCached:true});
    expect(await get(`asset-${id}`)).toBeTruthy();
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.open('keyval-store');request.onsuccess=()=>{const db=request.result;const tx=db.transaction('keyval','readwrite');tx.objectStore('keyval').delete(`asset-${id}`);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
    expect((await store.getState(id)).originalCached).toBe(false);
  });
  it('does not claim persistence after abort or quota failure and leaves preview intact',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'full'});await store.putPreview(id,preview());
    const put=IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:any,key?:IDBValidKey){
      if(key===`asset-${id}`)throw new DOMException('full','QuotaExceededError');return put.call(this,value,key);
    });
    await expect(store.putOriginal(id,original())).rejects.toThrow('full');
    expect(await store.getState(id)).toMatchObject({originalCached:false,previewCached:true,cacheError:'QUOTA'});
    vi.restoreAllMocks();
    vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:any,key?:IDBValidKey){const req=put.call(this,value,key);if(key===`asset-${id}`)this.transaction.abort();return req;});
    await expect(store.putOriginal(id,original())).rejects.toThrow();
    expect((await store.getState(id)).originalCached).toBe(false);
  });
  it('atomically reserves download intent across independent connections and records invocation separately',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'download'});const second=createImageResultStore();
    const claims=await Promise.all([store.claimDownload(id,'tab-a'),second.claimDownload(id,'tab-b')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await store.getState(id)).downloadState).toBe('claimed');
    expect(await second.claimDownload(id)).toBeNull();
    expect(await store.markDownloadStarted(id,'wrong')).toBe(false);
    expect(await store.markDownloadStarted(id,claims.find(Boolean)!)).toBe(true);
    expect((await second.getState(id)).downloadState).toBe('started');second.close();
  });
  it('adopts a known legacy blob only after ownership is explicitly established and retains old bytes',async()=>{
    await set('asset-legacy',original());const {id}=await store.register({ownerId:'a',jobId:'legacy'});
    await expect(store.adoptLegacy(id,'legacy','b')).rejects.toThrow();
    expect(await store.getOriginal(id)).toBeUndefined();
    expect(await store.adoptLegacy(id,'legacy','a')).toBe(true);
    expect(await store.getOriginal(id)).toBeTruthy();expect(await get('asset-legacy')).toBeTruthy();
  });
  it('reclaims only safe cloud-backed unpinned originals and preserves expired or unknown local copies',async()=>{
    const small=createImageResultStore({budgetBytes:20});
    const safe=await small.register({ownerId:'a',jobId:'safe',cloudBacked:true,cloudExpiresAt:Date.now()+3600000});
    const expired=await small.register({ownerId:'a',jobId:'expired',cloudBacked:true,cloudExpiresAt:Date.now()-1});
    await small.putOriginal(safe.id,original());await small.putOriginal(expired.id,original());
    await set('asset-unknown',original());
    const next=await small.register({ownerId:'a',jobId:'next'});await small.putOriginal(next.id,original());
    expect(await small.getOriginal(safe.id)).toBeUndefined();
    expect(await small.getOriginal(expired.id)).toBeTruthy();expect(await get('asset-unknown')).toBeTruthy();
    const release=small.pin(next.id);await small.getState(next.id);
    const last=await small.register({ownerId:'a',jobId:'last'});
    await expect(small.putOriginal(last.id,original())).rejects.toThrow();release();small.close();
  });
  it('shares the default-on preference and keeps an existing disabled canvas preference on migration',()=>{
    expect(store.getAutoDownloadPreference(false)).toBe(false);
    store.setAutoDownloadPreference(true);expect(createImageResultStore().getAutoDownloadPreference(false)).toBe(true);
  });
  it('migrates a disabled canvas preference even when classic opens first',()=>{
    localStorage.setItem('selection-storage',JSON.stringify({state:{autoDownloadOnSuccess:false},version:0}));
    expect(store.getAutoDownloadPreference(true)).toBe(false);
  });
  it('checks committed blob existence without cloning originals for list badges',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'badge'});await store.putOriginal(id,original());
    const reads=vi.spyOn(IDBObjectStore.prototype,'get');
    expect((await store.getState(id)).originalCached).toBe(true);
    expect(reads.mock.calls.some(([key])=>key===`asset-${id}` || key===`asset-preview-${id}`)).toBe(false);
  });
  it('scans only metadata ranges while budgeting a new original',async()=>{
    const {id}=await store.register({ownerId:'a',jobId:'ranges'});
    const cursors=vi.spyOn(IDBObjectStore.prototype,'openCursor');await store.putOriginal(id,original());
    expect(cursors).toHaveBeenCalledTimes(3);
    for(const [range] of cursors.mock.calls){expect(range).toBeTruthy();expect((range as IDBKeyRange).includes('asset-legacy-original')).toBe(false);}
  });
  it('honors pins from another tab while enforcing the shared byte budget',async()=>{
    const a=createImageResultStore({budgetBytes:12}),b=createImageResultStore({budgetBytes:12});
    const {id}=await a.register({ownerId:'a',jobId:'cross-tab-pin',cloudBacked:true,cloudExpiresAt:Date.now()+3600000});
    await a.putOriginal(id,original());const release=a.pin(id);await a.getState(id);
    const next=await b.register({ownerId:'a',jobId:'cross-tab-next'});
    await expect(b.putOriginal(next.id,original())).rejects.toThrow();
    expect(await b.getOriginal(id)).toBeTruthy();release();a.close();b.close();
  });
  it('retains an original quota failure after a later preview write succeeds',async()=>{
    const small=createImageResultStore({budgetBytes:8});const {id}=await small.register({ownerId:'a',jobId:'original-quota'});
    await expect(small.putOriginal(id,new Blob(['original is too big'],{type:'image/png'}))).rejects.toThrow();
    await small.putPreview(id,preview());
    expect(await small.getState(id)).toMatchObject({originalCached:false,previewCached:true,cacheError:'QUOTA'});small.close();
  });
  it('does not charge unrelated legacy canvas originals against the managed result budget',async()=>{
    await set('asset-legacy-canvas',original());
    await set('asset-meta-legacy-canvas',{bytes:4096,previewBytes:1024,createdAt:1});
    const small=createImageResultStore({budgetBytes:12});
    try {
      const {id}=await small.register({ownerId:'a',jobId:'new-classic'});
      await small.putOriginal(id,original());
      expect((await small.getState(id)).originalCached).toBe(true);
      expect(await get('asset-legacy-canvas')).toBeTruthy();
      expect(await get('asset-meta-legacy-canvas')).toEqual({bytes:4096,previewBytes:1024,createdAt:1});
    } finally {small.close();}
  });
  it('keeps space for previews when protected originals fill their budget',async()=>{
    const small=createImageResultStore({budgetBytes:12});
    try {
      const old=await small.register({ownerId:'a',jobId:'protected',cloudExpiresAt:Date.now()-1});
      await small.putOriginal(old.id,original());
      const next=await small.register({ownerId:'a',jobId:'preview-reserve'});
      await expect(small.putOriginal(next.id,original())).rejects.toThrow();
      await small.putPreview(next.id,preview(),{previewVersion:1});
      expect(await small.getState(next.id)).toMatchObject({originalCached:false,previewCached:true});
      expect(await small.getOriginal(old.id)).toBeTruthy();
    } finally {small.close();}
  });
  it('links only a confirmed exact canvas source without reading or duplicating blobs',async()=>{
    await set('asset-canvas-source',original());await set('asset-preview-canvas-source',preview());
    await set('asset-meta-canvas-source',{bytes:8,previewBytes:7,previewVersion:1,width:3840,height:2160});
    await set('asset-source-/provider','canvas-source');
    const {id}=await store.register({ownerId:'a',jobId:'linked',originalUrl:'/provider'});
    await expect(store.linkLegacySource(id,'b')).rejects.toThrow(/ownership/);
    expect(await store.getOriginal(id)).toBeUndefined();
    const reads=vi.spyOn(IDBObjectStore.prototype,'get');
    await store.linkLegacySource(id,'a');
    expect(await store.getState(id)).toMatchObject({originalCached:true,previewCached:true,width:3840,height:2160});
    expect(reads.mock.calls.some(([key])=>key==='asset-canvas-source' || key==='asset-preview-canvas-source')).toBe(false);
    reads.mockRestore();
    expect(await get(`asset-${id}`)).toBeUndefined();
    expect(await get('asset-meta-canvas-source')).toMatchObject({sharedResult:true,bytes:8});
    await store.register({ownerId:'a',jobId:'linked',originalUrl:'/site'});
    const reloaded=createImageResultStore();
    expect(await (await reloaded.getOriginal(id))?.text()).toBe('original');
    expect(await (await reloaded.getPreview(id))?.text()).toBe('preview');reloaded.close();
    const unrelated=await store.register({ownerId:'b',jobId:'linked',originalUrl:'/different'});
    await store.linkLegacySource(unrelated.id,'b');
    expect(await store.getOriginal(unrelated.id)).toBeUndefined();
    await set('asset-source-/foreign',id);
    const foreign=await store.register({ownerId:'b',jobId:'foreign',originalUrl:'/foreign'});
    await store.linkLegacySource(foreign.id,'b');
    expect(await store.getOriginal(foreign.id)).toBeUndefined();
  });
  it('evicts only the over-budget variant while keeping the other copy usable',async()=>{
    const small=createImageResultStore({budgetBytes:8,previewBudgetBytes:7});
    try {
      const safe=await small.register({ownerId:'a',jobId:'variants',cloudBacked:true,cloudExpiresAt:Date.now()+3600000});
      await small.putOriginal(safe.id,original());await small.putPreview(safe.id,preview());
      const next=await small.register({ownerId:'a',jobId:'next-variant'});
      await small.putOriginal(next.id,original());
      expect(await small.getState(safe.id)).toMatchObject({originalCached:false,previewCached:true});
      expect(await get(`asset-meta-${safe.id}`)).toMatchObject({bytes:0,previewBytes:7});
      await small.putPreview(next.id,preview());
      expect(await small.getState(next.id)).toMatchObject({originalCached:true,previewCached:true});
      expect(await small.getState(safe.id)).toMatchObject({originalCached:false,previewCached:false});
    } finally {small.close();}
  });
  it('does not retain a stale canvas source alias whose local bytes were removed',async()=>{
    await set('asset-source-/deleted-legacy','deleted-legacy');
    await set('asset-meta-deleted-legacy',{bytes:8,previewVersion:1});
    const {id}=await store.register({ownerId:'a',jobId:'stale-alias',originalUrl:'/deleted-legacy'});
    await store.linkLegacySource(id,'a');
    expect(await store.getState(id)).not.toHaveProperty('legacySourceAssetId');
  });
});
