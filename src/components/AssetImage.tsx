import React, { useEffect, useRef, useState } from 'react';
import { useImageAsset } from '../hooks/useImageAsset';
import type { ImageAssetRef, AssetVariant } from '../services/imageAssetTypes';

export function AssetImage({asset,variant='preview',className,alt='',lazy=false,onClick}: {
  asset:ImageAssetRef;variant?:AssetVariant;className?:string;alt?:string;lazy?:boolean;onClick?:React.MouseEventHandler;
}) {
  const ref=useRef<HTMLDivElement>(null); const [visible,setVisible]=useState(!lazy);
  const [showPreview,setShowPreview]=useState(false);
  useEffect(()=>{
    if(!lazy || !ref.current || typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(items=>setVisible(items.some(i=>i.isIntersecting)),{rootMargin:'160px'});
    observer.observe(ref.current);return()=>observer.disconnect();
  },[lazy]);
  const image=useImageAsset(asset,{variant:showPreview ? 'preview' : variant,enabled:visible});
  return <div ref={ref} className={className} onClick={onClick}>
    {image.status==='ready' ? <img src={image.url} alt={alt} className="w-full h-full object-contain" decoding="async" /> :
      <div className="min-h-24 flex flex-col items-center justify-center text-xs text-gray-400 p-3">
        <span>{!visible?'图片':image.status==='reading'?'正在读取图片…':image.status==='missing'?'本地图片缺失或链接已失效':image.message || '图片读取失败'}</span>
        {visible && image.status!=='reading' && <button className="mt-2 px-3 py-2 bg-white/10 rounded" onClick={e=>{e.stopPropagation();image.retry();}}>重新读取图片</button>}
        {image.status!=='reading' && variant==='original' && !showPreview && <button className="mt-2 px-3 py-2 bg-white/10 rounded" onClick={e=>{e.stopPropagation();setShowPreview(true);}}>查看预览图</button>}
      </div>}
  </div>;
}
