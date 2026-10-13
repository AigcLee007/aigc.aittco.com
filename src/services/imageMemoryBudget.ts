const ORIGINAL_BUDGET = 96 * 1024 * 1024;
const leases = new Map<string, {bytes:number;refs:number}>();
export function acquireOriginalImageLease(key: string, width: number, height: number): (() => void) | null {
  const bytes = width && height ? width*height*4 : 32*1024*1024;
  const previous=leases.get(key);
  if (!previous && [...leases.values()].reduce((sum,item)=>sum+item.bytes,0)+bytes > ORIGINAL_BUDGET) return null;
  if (previous) previous.refs++; else leases.set(key,{bytes,refs:1});
  let released=false;
  return () => { if(released)return; released=true; const item=leases.get(key); if(item && --item.refs===0)leases.delete(key); };
}
export const originalMemorySnapshot = () => ({count:leases.size,bytes:[...leases.values()].reduce((sum,item)=>sum+item.bytes,0)});
