import { get, set } from 'idb-keyval';
import { assetStorage, isValidAssetBlob, pinAsset } from './assetStorage';
import { bounded, ImageAssetError, type ImageAssetRef, type AssetVariant, type ImageAssetStatus } from './imageAssetTypes';
import { createPreview, decodeImage } from './imagePreview';
import { acquireOriginalImageLease } from './imageMemoryBudget';
import { getProxiedImageUrl } from '../utils/mediaProxy';
import { getLocalLine4ThumbnailUrl } from '../utils/generatedImageStorage';
import { imageDimensions } from './imageDimensions';
import { takeSourcePreparationSlot } from './imagePreparationQueue';

const sourceReads=new Map<string,Promise<{blob:Blob;assetId?:string}>>();
const sourceIds=new Map<string,string>();
const validatedOriginals=new WeakSet<Blob>();
const originalValidation=new Map<string,Promise<void>>();
async function validateOriginal(blob:Blob,key:string) {
  if(validatedOriginals.has(blob))return;
  let work=originalValidation.get(key);
  if(!work){work=createPreview(blob,true).then(()=>{validatedOriginals.add(blob);});originalValidation.set(key,work);}
  try{await work;}finally{if(originalValidation.get(key)===work)originalValidation.delete(key);}
}
const entries=new Map<string,Entry>();
interface PendingRead { work:Promise<Entry>; controller:AbortController; readers:number; ref:ImageAssetRef }
const pending=new Map<string,PendingRead>();
let loadCount=0;
const loadWaiters:Array<()=>void>=[];
async function takeLoadSlot() {
  if(loadCount>=3)await new Promise<void>(resolve=>loadWaiters.push(resolve));else loadCount++;
  return ()=>{const next=loadWaiters.shift();if(next)next();else loadCount--;};
}
let fetchCount=0;
const fetchWaiters:Array<()=>void>=[];
async function takeFetchSlot() {
  if(fetchCount>=3)await new Promise<void>(resolve=>fetchWaiters.push(resolve));
  else fetchCount++;
  return ()=>{const next=fetchWaiters.shift();if(next)next();else fetchCount--;};
}
interface Entry { url:string; image:HTMLImageElement; refs:number; bytes:number; touched:number; variant:AssetVariant; dispose:()=>void }
export interface ImageLease { status:ImageAssetStatus; url?:string; image?:HTMLImageElement; message?:string; release:()=>void }
export const imageAssetKey = (ref:ImageAssetRef,variant:AssetVariant='preview') => ref.assetId
  ? `${variant}:asset:${ref.assetId}`
  : `${variant}:source:${ref.src || ''}|${ref.thumbnailSrc || ''}`;

async function fetchImage(src:string,timeoutMs:number):Promise<Blob> {
  const deadline=Date.now()+timeoutMs;
  const releaseSlot=await takeFetchSlot();
  const controller=new AbortController();
  try {
    if(Date.now()>=deadline)throw new ImageAssetError('TIMEOUT','图片读取超时');
    const response=await bounded(fetch(getProxiedImageUrl(src),{signal:controller.signal}),timeoutMs);
    if (!response.ok) throw new ImageAssetError(response.status===404 || response.status===410?'NOT_FOUND':'NETWORK',`图片读取失败 (${response.status})`);
    const blob=await bounded(response.blob(),timeoutMs);
    if (!isValidAssetBlob(blob)) throw new ImageAssetError('DECODE','图片内容无效');
    return blob;
  } finally { controller.abort();releaseSlot(); }
}

export async function cacheImageSource(src:string,timeoutMs=15000,forceRemote=false):Promise<{blob:Blob;assetId?:string}> {
  if (!src) throw new ImageAssetError('EMPTY','没有图片来源');
  const previous=sourceReads.get(src); if(previous)return previous;
  const work=(async () => {
    const releasePreparation=await takeSourcePreparationSlot(Math.min(45000,timeoutMs*3));
    try {
    let known=forceRemote ? undefined : sourceIds.get(src);
    if (!forceRemote && !known && !/^(data:|blob:)/i.test(src)) { try { known=await bounded(get<string>(`asset-source-${src}`),timeoutMs); } catch {} }
    if (known) { const blob=await assetStorage.getBlob(known); if(isValidAssetBlob(blob)){sourceIds.set(src,known);return {blob,assetId:known};} }
    const blob=await fetchImage(src,timeoutMs); let assetId:string|undefined;
    try {
      assetId=await assetStorage.storeBlob(blob); sourceIds.set(src,assetId);
      if(sourceIds.size>256)sourceIds.delete(sourceIds.keys().next().value!);
      if (!/^(data:|blob:)/i.test(src)) await bounded(set(`asset-source-${src}`,assetId),timeoutMs);
    } catch { /* Quota/IDB failure still permits displaying and downloading. */ }
    return {blob,assetId};
    }finally{releasePreparation();}
  })();
  sourceReads.set(src,work);
  try{return await work;}finally{if(sourceReads.get(src)===work)sourceReads.delete(src);}
}

async function readOriginal(ref:ImageAssetRef,timeoutMs:number) {
  if(ref.assetId){
    try{
      const blob=await assetStorage.getBlob(ref.assetId);
      if(isValidAssetBlob(blob)){await bounded(validateOriginal(blob,ref.assetId),timeoutMs);return {blob,assetId:ref.assetId};}
    }catch(error){
      if(!ref.src)throw error;
      return readOriginalSource(ref.src,timeoutMs);
    }
  }
  // A preview can never satisfy an original consumer.
  return readOriginalSource(ref.src || '',timeoutMs);
}
async function readOriginalSource(src:string,timeoutMs:number) {
  const remote=await cacheImageSource(src,timeoutMs);
  try {
    await bounded(validateOriginal(remote.blob,remote.assetId || src),timeoutMs);
    return remote;
  }catch(error){
    if(!remote.assetId || !src)throw error;
    const recovered=await cacheImageSource(src,timeoutMs,true);
    await bounded(validateOriginal(recovered.blob,recovered.assetId || src),timeoutMs);
    return recovered;
  }
}
export async function readOriginalBlob(ref:ImageAssetRef,timeoutMs=15000):Promise<Blob> {
  return (await readOriginal(ref,timeoutMs)).blob;
}

async function load(ref:ImageAssetRef,variant:AssetVariant,timeoutMs:number,key:string,signal?:AbortSignal):Promise<Entry> {
  const releaseSlot=await takeLoadSlot();
  try {
    if(signal?.aborted)throw new ImageAssetError('TIMEOUT','图片读取已取消');
    return await loadWithinSlot(ref,variant,timeoutMs,key,signal);
  }finally{releaseSlot();}
}
async function loadWithinSlot(ref:ImageAssetRef,variant:AssetVariant,timeoutMs:number,key:string,signal?:AbortSignal):Promise<Entry> {
  let blob:Blob|undefined; let assetId=ref.assetId; let unpin:()=>void=()=>{};
  let releaseBudget:()=>void=()=>{}; let url='';
  try {
    if(assetId)unpin=pinAsset(assetId);
    if(variant==='preview' && assetId){try{blob=await assetStorage.ensurePreview(assetId);}catch{}}
    const thumbnail=ref.thumbnailSrc || getLocalLine4ThumbnailUrl(ref.src);
    if(!blob && variant==='preview' && thumbnail){try{blob=(await createPreview(await fetchImage(thumbnail,timeoutMs))).blob;}catch{}}
    if(!blob){
      const original=await readOriginal(ref,timeoutMs); assetId=original.assetId;
      if(signal?.aborted)throw new ImageAssetError('TIMEOUT','图片读取已取消');
      if(assetId){unpin();unpin=pinAsset(assetId);}
      if(variant==='preview') {
        try{blob=assetId ? await assetStorage.ensurePreview(assetId) : (await createPreview(original.blob)).blob;}
        catch(error){
          // If preview creation is unavailable, admit only a budgeted original.
          unpin(); unpin=()=>{};
          return loadWithinSlot(ref,'original',timeoutMs,key,signal);
        }
      } else {
        const meta=assetId ? await assetStorage.getMeta(assetId) : undefined;
        const dimensions=meta?.width ? {width:meta.width,height:meta.height || 0} : await imageDimensions(original.blob);
        const lease=acquireOriginalImageLease(key,dimensions?.width || 0,dimensions?.height || 0);
        if(!lease)throw new ImageAssetError('BUDGET','原图较大，请关闭其他原图后重试');
        releaseBudget=lease; blob=original.blob;
      }
    }
    if(signal?.aborted)throw new ImageAssetError('TIMEOUT','图片读取已取消');
    url=URL.createObjectURL(blob);
    let image:HTMLImageElement;
    try { image=await decodeImage(url,timeoutMs); }
    catch(error) {
      URL.revokeObjectURL(url);url='';
      if (variant!=='preview') {
        if(!ref.src)throw error;
        const remote=await cacheImageSource(ref.src,timeoutMs,true);
        blob=remote.blob;url=URL.createObjectURL(blob);
        image=await decodeImage(url,timeoutMs);
      } else {
      // A corrupt preview must not hide a recoverable local original.
      try {
        if(!assetId)throw error;
        blob=await assetStorage.ensurePreview(assetId,true);
      }catch(localError){
        if(!ref.src)throw localError;
        const remote=await cacheImageSource(ref.src,timeoutMs,true);
        blob=remote.assetId ? await assetStorage.ensurePreview(remote.assetId) : (await createPreview(remote.blob)).blob;
      }
        url=URL.createObjectURL(blob);image=await decodeImage(url,timeoutMs);
      }
    }
    if(variant==='original') {
      releaseBudget();releaseBudget=()=>{};
      const corrected=acquireOriginalImageLease(key,image.naturalWidth,image.naturalHeight);
      if(!corrected){image.src='';throw new ImageAssetError('BUDGET','原图较大，请关闭其他原图后重试');}
      releaseBudget=corrected;
    }
    let disposed=false;
    const dispose=()=>{if(disposed)return;disposed=true;image.src='';URL.revokeObjectURL(url);unpin();releaseBudget();};
    return {url,image,refs:0,bytes:image.naturalWidth*image.naturalHeight*4,touched:Date.now(),variant,dispose};
  }catch(error){if(url)URL.revokeObjectURL(url);unpin();releaseBudget();throw error;}
}

function trim() {
  let bytes=[...entries.values()].reduce((sum,item)=>sum+item.bytes,0);
  for(const [key,item] of [...entries].sort((a,b)=>a[1].touched-b[1].touched)){
    if(item.refs || (item.variant==='preview' && bytes<=32*1024*1024 && entries.size<=64))continue;
    entries.delete(key);bytes-=item.bytes;item.dispose();
  }
}

export async function acquireImageAsset(ref:ImageAssetRef,{variant='preview',timeoutMs=15000,signal}:{variant?:AssetVariant;timeoutMs?:number;signal?:AbortSignal}={}):Promise<ImageLease> {
  const key=imageAssetKey(ref,variant);
  try{
    let entry=entries.get(key);
    if(!entry){
      let job=pending.get(key);
      if(!job || job.controller.signal.aborted){
        const controller=new AbortController();
        const sharedRef={...ref};
        const loading=load(sharedRef,variant,timeoutMs,key,controller.signal);
        const work=bounded(loading,Math.min(45000,timeoutMs*3)).catch(error=>{
          controller.abort();
          void loading.then(late=>late.dispose(),()=>{}); throw error;
        });
        const created:PendingRead={work,controller,readers:0,ref:sharedRef};
        created.work=work.then(result=>{
          if(created.readers===0){result.dispose();throw new ImageAssetError('TIMEOUT','图片读取已取消');}
          entries.set(key,result);return result;
        });
        job=created;pending.set(key,job);
      }
      // Asset identity is shared; retain fallback candidates supplied by any view.
      if(!job.ref.src && ref.src)job.ref.src=ref.src;
      if(!job.ref.thumbnailSrc && ref.thumbnailSrc)job.ref.thumbnailSrc=ref.thumbnailSrc;
      job.readers++;
      const ownedJob=job;let dropped=false;
      const drop=()=>{if(dropped)return;dropped=true;if(--ownedJob.readers===0)ownedJob.controller.abort();};
      signal?.addEventListener('abort',drop,{once:true});
      try {
        if(signal?.aborted)drop();
        entry=await ownedJob.work;
        if(signal?.aborted)throw new ImageAssetError('TIMEOUT','图片读取已取消');
      }finally{signal?.removeEventListener('abort',drop);if(!dropped)ownedJob.readers--;if(pending.get(key)===ownedJob)pending.delete(key);}
    }
    if(signal?.aborted)throw new ImageAssetError('TIMEOUT','图片读取已取消');
    entry.refs++; entry.touched=Date.now(); trim(); let released=false; const owned=entry;
    return {status:'ready',url:entry.url,image:entry.image,release:()=>{if(released)return;released=true;owned.refs--;owned.touched=Date.now();trim();}};
  }catch(error){
    const code=error instanceof ImageAssetError?error.code:'NETWORK';
    return {status:code==='BUDGET'?'deferred':code==='EMPTY'||code==='NOT_FOUND'?'missing':'failed',message:error instanceof Error?error.message:'图片读取失败',release:()=>{}};
  }
}
export function resetImageAssetCache(){for(const [key,item] of entries){if(!item.refs){entries.delete(key);item.dispose();}}}
export const imageAssetCacheSnapshot=()=>({entries:entries.size,active:[...entries.values()].filter(e=>e.refs>0).length,decodedBytes:[...entries.values()].reduce((n,e)=>n+e.bytes,0),pending:pending.size});
