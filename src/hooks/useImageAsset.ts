import { useEffect, useState } from 'react';
import { acquireImageAsset, imageAssetKey, type ImageLease } from '../services/imageAssetCache';
import type { ImageAssetRef, AssetVariant } from '../services/imageAssetTypes';

export function useImageAsset(ref:ImageAssetRef,{variant='preview',enabled=true}:{variant?:AssetVariant;enabled?:boolean}={}) {
  const key=imageAssetKey(ref,variant); const [retry,setRetry]=useState(0);
  const [state,setState]=useState<{key:string;attempt:number;lease:ImageLease}>();
  useEffect(()=>{
    if(!enabled)return;
    let active=true;let lease:ImageLease|undefined;const controller=new AbortController();
    const deadline=Date.now()+45000;
    const onVisible=()=>{
      if(active && !lease && document.visibilityState==='visible' && Date.now()>=deadline){
        controller.abort();active=false;
        setState({key,attempt:retry,lease:{status:'failed',message:'图片读取超时，请重试',release:()=>{}}});
      }
    };
    document.addEventListener('visibilitychange',onVisible);
    void acquireImageAsset(ref,{variant,signal:controller.signal}).then(result=>{
      if(!active){result.release();return;}lease=result;setState({key,attempt:retry,lease:result});
    });
    return ()=>{active=false;document.removeEventListener('visibilitychange',onVisible);controller.abort();lease?.release();};
  },[key,retry,enabled,ref.src,ref.thumbnailSrc]);
  const current=enabled && state?.key===key && state.attempt===retry?state.lease:undefined;
  const displayed: ImageLease = current || {status:'reading',release:()=>{}};
  return {...displayed,retry:()=>setRetry(n=>n+1)};
}
