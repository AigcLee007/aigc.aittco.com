import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import type { NodeData } from '../../types';
import { canvasResultIdentity, registerCanvasResult, recoverCanvasResult } from './canvasResultIdentity';
import { imageResultStore } from './imageResultStore';
const node={id:'node-a',type:'IMAGE',x:0,y:0,width:512,height:512,generationOwnerId:'owner-a',taskId:'job-a',clientRequestId:'request-a',generationResultIndex:2,generationStartedAt:100} as NodeData;
it('uses explicit job/output identity and protects links with unknown expiry',()=>{
  expect(canvasResultIdentity(node,'/site')).toMatchObject({ownerId:'owner-a',jobId:'job-a',outputIndex:2,createdAt:100,cloudBacked:false});
  expect(canvasResultIdentity({...node,generationOwnerId:undefined},'/site')).toBeUndefined();
  expect(canvasResultIdentity({...node,taskId:undefined,clientRequestId:undefined},'/site')?.jobId).toBe('node-node-a');
});
it('shares an explicitly owned legacy canvas original with classic without fetching or deleting it',async()=>{
  vi.stubGlobal('Blob',NodeBlob);await clear();
  try {
    await set('asset-owned-legacy',new Blob(['legacy bytes'],{type:'image/png'}));
    const info=await registerCanvasResult({...node,assetId:'owned-legacy'},'/api/image-job-assets/owned');
    expect(await (await imageResultStore.getOriginal(info!.id))!.text()).toBe('legacy bytes');
    expect(await get('asset-owned-legacy')).toBeTruthy();
    expect(await registerCanvasResult({...node,generationOwnerId:undefined,assetId:'owned-legacy'},'/unknown-owner')).toBeUndefined();
  } finally {vi.unstubAllGlobals();}
});
it('never extends expiry from browser delivery time when recovering an old server result',()=>{
  const old='2026-10-14T00:00:00.000Z';
  expect(canvasResultIdentity({...node,createdAt:new Date().toISOString()},'/api/image-job-assets/old')?.cloudBacked).toBe(false);
  expect(canvasResultIdentity({...node,createdAt:new Date().toISOString()},'/api/image-job-assets/old',old)?.cloudExpiresAt).toBe(Date.parse(old)+4*3600000);
});
it('keeps recovered sibling outputs distinct when legacy nodes lack an output index',async()=>{
  vi.stubGlobal('Blob',NodeBlob);await clear();
  try {
    const first={...node,id:'legacy-first',generationResultIndex:undefined,assetId:'legacy-first'};
    const second={...node,id:'legacy-second',generationResultIndex:undefined,assetId:'legacy-second'};
    await set('asset-legacy-first',new Blob(['first original'],{type:'image/png'}));
    await set('asset-legacy-second',new Blob(['second original'],{type:'image/png'}));
    const recoveredFirst=await recoverCanvasResult(first,{taskId:node.taskId!,slot:0,source:'/result-first'});
    const recoveredSecond=await recoverCanvasResult(second,{taskId:node.taskId!,slot:1,source:'/result-second'});
    expect(recoveredFirst?.id).not.toBe(recoveredSecond?.id);
    expect(await (await imageResultStore.getOriginal(recoveredFirst!.id))!.text()).toBe('first original');
    expect(await (await imageResultStore.getOriginal(recoveredSecond!.id))!.text()).toBe('second original');
    expect(recoveredSecond?.outputIndex).toBe(1);
  }finally{vi.unstubAllGlobals();}
});
