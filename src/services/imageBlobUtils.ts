export const blobToDataUrl = (blob:Blob):Promise<string> => new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>typeof reader.result==='string' ? resolve(reader.result) : reject(new Error('图片读取失败'));
  reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
});
