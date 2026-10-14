import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import { assetStorage } from './assetStorage';
import { acquireImageAsset, cacheImageSource, readOriginalBlob, resetImageAssetCache } from './imageAssetCache';
import { imageResultStore } from './imageResultStore';

const png = () => new Blob(['original bytes'], { type: 'image/png' });
class TestImage {
  naturalWidth = 720; naturalHeight = 405;
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
}
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob);
  await clear();
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width:3840,height:2160,close:vi.fn()})));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({drawImage:vi.fn()} as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['preview'], {type:'image/webp'})));
  URL.createObjectURL = vi.fn(() => `blob:test-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(png())));
});
afterEach(() => { resetImageAssetCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('image asset recovery and lifecycle', () => {
  it('shares generated originals across classic and canvas URLs without decoding during caching',async()=>{
    const identity={ownerId:'shared-owner',jobId:'job-shared',outputIndex:0};
    const info=await imageResultStore.register({...identity,originalUrl:'/provider-original'});
    await imageResultStore.putOriginal(info.id,png());
    const cached=await cacheImageSource('/site-original',15000,false,identity);
    expect(cached.assetId).toBe(info.id);expect(fetch).not.toHaveBeenCalled();expect(createImageBitmap).not.toHaveBeenCalled();
    expect((await imageResultStore.find(identity.ownerId,'/site-original'))?.id).toBe(info.id);
  });
  it('keeps generated source aliases scoped to owners in memory and durable storage',async()=>{
    const a=await cacheImageSource('/same-owner-source',15000,false,{ownerId:'owner-a',jobId:'job-a'});
    const b=await cacheImageSource('/same-owner-source',15000,false,{ownerId:'owner-b',jobId:'job-b'});
    expect(a.assetId).not.toBe(b.assetId);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('protects shared results from canvas-only unused-node cleanup',async()=>{
    const info=await imageResultStore.register({ownerId:'a',jobId:'old-shared',createdAt:Date.now()-9*86400000});
    await imageResultStore.putOriginal(info.id,png());await assetStorage.cleanupUnusedAssets([]);
    expect(await imageResultStore.getOriginal(info.id)).toBeTruthy();
  });
  it('repairs corrupt shared originals under the same owner identity without a global source alias',async()=>{
    const identity={ownerId:'repair-owner',jobId:'job-repair'};
    const info=await imageResultStore.register({...identity,originalUrl:'/shared-repair'});
    await imageResultStore.putOriginal(info.id,new Blob(['corrupt'],{type:'image/png'}));
    vi.mocked(createImageBitmap).mockImplementation(async(blob:any)=>{if(await blob.text()==='corrupt')throw new Error('corrupt');return {width:3840,height:2160,close:vi.fn()} as any;});
    expect(await (await readOriginalBlob({assetId:info.id,src:'/shared-repair'})).text()).toBe('original bytes');
    expect(await (await imageResultStore.getOriginal(info.id))!.text()).toBe('original bytes');
    expect(await get('asset-source-/shared-repair')).toBeUndefined();
  });
  it('downloads stored original bytes without a full image decode',async()=>{
    await set('asset-download-bytes',png());
    expect(await (await readOriginalBlob({assetId:'download-bytes'},15000,{validate:false})).text()).toBe('original bytes');
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it('reads legacy local original before a broken remote URL and never substitutes a thumbnail', async () => {
    const original = png(); await set('asset-old', original);
    expect(await readOriginalBlob({assetId:'old',src:'https://expired/image',thumbnailSrc:'/thumb.webp'})).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValue(new Response('',{status:404}));
    await expect(readOriginalBlob({src:'/missing.png',thumbnailSrc:'/thumb.webp'})).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('shares local preview decoding, releases only after the final reader, and recovers original bytes', async () => {
    await set('asset-old', png());
    const [a,b] = await Promise.all([acquireImageAsset({assetId:'old'}),acquireImageAsset({assetId:'old'})]);
    expect(a.status).toBe('ready'); expect(a.url).toBe(b.url); expect(a.image).toBe(b.image);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    a.release(); expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(b.url);
    b.release(); resetImageAssetCache(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(b.url);
    expect(await (await assetStorage.getBlob('old'))!.text()).toBe('original bytes');
    expect((await get<Blob>('asset-preview-old'))!.type).toBe('image/webp');
  });
  it('shares one decoded preview when local-only and remote-backed views reference the same asset',async()=>{
    await set('asset-one-identity',png());
    const [a,b]=await Promise.all([
      acquireImageAsset({assetId:'one-identity'}),
      acquireImageAsset({assetId:'one-identity',src:'/canonical-original',thumbnailSrc:'/canonical-preview'}),
    ]);
    expect(a.status).toBe('ready');expect(b.status).toBe('ready');
    const shared=a.image===b.image && a.url===b.url;
    a.release();b.release();
    expect(shared).toBe(true);expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a shared remote recovery candidate when another view only knows a missing local asset ID',async()=>{
    const [a,b]=await Promise.all([
      acquireImageAsset({assetId:'shared-missing-local'}),
      acquireImageAsset({assetId:'shared-missing-local',src:'/recover-shared-local'}),
    ]);
    const statuses=[a.status,b.status];a.release();b.release();
    expect(statuses).toEqual(['ready','ready']);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('falls back from corrupt local data to remote, and empty/missing assets reach a terminal state', async () => {
    await set('asset-bad',new Blob(['html'],{type:'text/html'}));
    const a=await acquireImageAsset({assetId:'bad',src:'/image.png'});
    expect(a.status).toBe('ready'); a.release();
    expect((await acquireImageAsset({})).status).toBe('missing');
    vi.mocked(fetch).mockResolvedValue(new Response('',{status:404}));
    expect((await acquireImageAsset({assetId:'gone',src:'/gone'})).status).toBe('missing');
  });
  it('bounds hanging network reads and permits a clean retry', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const result=acquireImageAsset({src:'/hung'}, {timeoutMs:25});
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).status).toBe('failed');
    vi.useRealTimers();
    vi.mocked(fetch).mockResolvedValue(new Response(png()));
    const retry=await acquireImageAsset({src:'/hung'}); expect(retry.status).toBe('ready'); retry.release();
  });
  it('commits original before preview failure and keeps unknown legacy assets during cleanup', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(cb=>cb(null));
    const id=await assetStorage.storeBlob(png());
    await expect(assetStorage.ensurePreview(id)).rejects.toThrow();
    expect(await assetStorage.getBlob(id)).toBeTruthy();
    expect(await (await readOriginalBlob({assetId:id})).text()).toBe('original bytes');
    await set('asset-unknown',png());
    expect((await assetStorage.cleanupUnusedAssets([])).removed).toBe(0);
  });
  it('displays a generated preview even when local preview persistence runs out of quota',async()=>{
    await set('asset-full-storage',png());
    const put=IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:any,key?:IDBValidKey){
      if(String(key).startsWith('asset-preview-'))throw new DOMException('full','QuotaExceededError');
      return put.call(this,value,key);
    });
    const preview=await assetStorage.ensurePreview('full-storage');
    expect(preview.type).toBe('image/webp');
    expect(await (await assetStorage.getBlob('full-storage'))!.text()).toBe('original bytes');
  });
  it('recovers corrupt image-typed local bytes for original consumers without using previews',async()=>{
    await set('asset-corrupt-image',png());
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('corrupt'));
    const recovered=await readOriginalBlob({assetId:'corrupt-image',src:'/valid-original'});
    expect(await recovered.text()).toBe('original bytes');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries the remote original when a source-only local mapping contains corrupt image bytes',async()=>{
    await set('asset-mapped-corrupt',png());
    await set('asset-source-/mapped-original','mapped-corrupt');
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('corrupt mapped original'));
    const recovered=await readOriginalBlob({src:'/mapped-original'});
    expect(await recovered.text()).toBe('original bytes');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses the repaired local original on subsequent reads while offline',async()=>{
    await set('asset-corrupt-again',new Blob(['corrupt'],{type:'image/png'}));
    vi.mocked(createImageBitmap).mockImplementation(async(blob:any)=>{
      if(await blob.text()==='corrupt')throw new Error('corrupt');
      return {width:3840,height:2160,close:vi.fn()} as any;
    });
    const ref={assetId:'corrupt-again',src:'/repair-once'};
    expect(await (await readOriginalBlob(ref)).text()).toBe('original bytes');
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    expect(await (await readOriginalBlob(ref)).text()).toBe('original bytes');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancelling one shared reader cannot revoke another reader\'s live image',async()=>{
    await set('asset-cancel',png());
    const controller=new AbortController();
    const a=acquireImageAsset({assetId:'cancel'});
    const b=acquireImageAsset({assetId:'cancel'},{signal:controller.signal});
    controller.abort();
    const active=await a;await b;
    expect(active.status).toBe('ready');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(active.url);
    active.release();resetImageAssetCache();expect(URL.revokeObjectURL).toHaveBeenCalledWith(active.url);
  });
  it('shares concurrent remote reads and previews separately from original bytes',async()=>{
    const [a,b]=await Promise.all([cacheImageSource('/shared-original'),cacheImageSource('/shared-original')]);
    expect(fetch).toHaveBeenCalledTimes(1);expect(a.assetId).toBe(b.assetId);
    const lease=await acquireImageAsset({assetId:a.assetId});
    expect(await a.blob.text()).toBe('original bytes');expect(lease.status).toBe('ready');lease.release();
  });
  it('bounds downloaded originals until their local cache writes finish',async()=>{
    let finish:()=>void=()=>{};const held=new Promise<void>(resolve=>{finish=resolve;});
    const write=assetStorage.storeBlob.bind(assetStorage);
    vi.spyOn(assetStorage,'storeBlob').mockImplementation(async blob=>{await held;return write(blob);});
    const reads=Array.from({length:20},(_,i)=>cacheImageSource(`/slow-write-${i}`));
    await new Promise(resolve=>setTimeout(resolve,50));
    const buffered=vi.mocked(fetch).mock.calls.length;
    finish();await Promise.all(reads);
    expect(buffered).toBeLessThanOrEqual(3);
  });
  it('reads only one local original while preview decoding is busy',async()=>{
    for(let i=0;i<12;i++)await set(`asset-preview-queue-${i}`,png());
    let finish:()=>void=()=>{};const held=new Promise<void>(resolve=>{finish=resolve;});
    vi.mocked(createImageBitmap).mockImplementation(async()=>{await held;return {width:3840,height:2160,close:vi.fn()} as any;});
    const read=vi.spyOn(assetStorage,'getBlob');
    const previews=Array.from({length:12},(_,i)=>assetStorage.ensurePreview(`preview-queue-${i}`));
    await new Promise(resolve=>setTimeout(resolve,50));
    const buffered=read.mock.calls.length;
    finish();await Promise.all(previews);
    expect(buffered).toBe(1);
  });
});
