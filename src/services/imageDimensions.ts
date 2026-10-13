// Read common raster headers without allocating a full decoded pixel buffer.
export async function imageDimensions(blob:Blob):Promise<{width:number;height:number}|undefined> {
  const buffer=await blob.slice(0,262144).arrayBuffer();const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length>=24 && view.getUint32(0)===0x89504e47)return {width:view.getUint32(16),height:view.getUint32(20)};
  if(bytes.length>=10 && String.fromCharCode(...bytes.slice(0,3))==='GIF')return {width:view.getUint16(6,true),height:view.getUint16(8,true)};
  if(bytes.length>=30 && String.fromCharCode(...bytes.slice(8,12))==='WEBP') {
    const kind=String.fromCharCode(...bytes.slice(12,16));
    if(kind==='VP8X')return {width:1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),height:1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)};
    if(kind==='VP8 ')return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
    if(kind==='VP8L'){const bits=view.getUint32(21,true);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};}
  }
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216) {
    let offset=2;
    while(offset+9<bytes.length){
      if(bytes[offset++]!==255)continue;
      const marker=bytes[offset++];
      if(marker===216 || marker===217 || marker===0 || marker===255)continue;
      const size=view.getUint16(offset);if(size<2)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
      offset+=size;
    }
  }
  return undefined;
}
