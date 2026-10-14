import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi } from 'vitest';
import { clear, get, set } from 'idb-keyval';
import type { NodeData } from '../../types';
import { canvasResultIdentity, registerCanvasResult } from './canvasResultIdentity';
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
