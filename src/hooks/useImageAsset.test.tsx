import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useImageAsset } from './useImageAsset';
import { acquireImageAsset } from '../services/imageAssetCache';
vi.mock('../services/imageAssetCache',()=>({
  imageAssetKey:(ref:any,variant:string)=>`${variant}:${ref.assetId || ref.src || ''}`,
  acquireImageAsset:vi.fn(),
}));
const lease=()=>({status:'ready' as const,url:'blob:preview',release:vi.fn()});
beforeEach(()=>vi.clearAllMocks());
describe('image hook lifecycle',()=>{
  it('discards a late result after source replacement and releases it',async()=>{
    let resolveOld:(value:any)=>void=()=>{};
    vi.mocked(acquireImageAsset).mockImplementationOnce(()=>new Promise(r=>{resolveOld=r;})).mockResolvedValueOnce(lease());
    const {result,rerender,unmount}=renderHook(({src})=>useImageAsset({src}),{initialProps:{src:'old'}});
    rerender({src:'new'});await waitFor(()=>expect(result.current.status).toBe('ready'));
    const old=lease();await act(async()=>resolveOld(old));expect(old.release).toHaveBeenCalledTimes(1);
    unmount();
  });
  it('retries resource reads without a generation request and releases on unmount',async()=>{
    const ready=lease();vi.mocked(acquireImageAsset).mockResolvedValueOnce({status:'missing',release:vi.fn()}).mockResolvedValueOnce(ready);
    const {result,unmount}=renderHook(()=>useImageAsset({assetId:'old'}));
    await waitFor(()=>expect(result.current.status).toBe('missing'));
    act(()=>result.current.retry());await waitFor(()=>expect(result.current.status).toBe('ready'));
    expect(acquireImageAsset).toHaveBeenCalledTimes(2);unmount();expect(ready.release).toHaveBeenCalledTimes(1);
  });
});
