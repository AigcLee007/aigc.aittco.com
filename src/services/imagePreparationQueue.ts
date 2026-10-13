import { ImageAssetError } from './imageAssetTypes';

// Reserve capacity before reading bytes, and hold it through persistence/decode.
// Waiting jobs retain references/IDs only; they do not fetch another original.
function preparationQueue(limit:number) {
  let active=0;
  const waiters:Array<()=>void>=[];
  return async (timeoutMs=45000):Promise<()=>void> => {
    if(active<limit)active++;
    else await new Promise<void>((resolve,reject)=>{
      const start=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{
        const index=waiters.indexOf(start);if(index>=0)waiters.splice(index,1);
        reject(new ImageAssetError('TIMEOUT','图片读取排队超时，请重试'));
      },timeoutMs);
      waiters.push(start);
    });
    let released=false;
    return ()=>{
      if(released)return;released=true;
      const next=waiters.shift();if(next)next();else active--;
    };
  };
}

export const takeSourcePreparationSlot=preparationQueue(3);
export const takePreviewPreparationSlot=preparationQueue(1);
