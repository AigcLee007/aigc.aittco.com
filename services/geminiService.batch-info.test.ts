import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateImage, editImage } from './geminiService';
import { submitImageJob } from '../src/services/imageJobClient';
vi.mock('../src/services/accountIdentity', () => ({ getAuthorizedBillingHeaders: vi.fn().mockResolvedValue({ 'X-Auth-Session': 'batch-session' }) }));
vi.mock('../src/services/imageJobClient', async importOriginal => ({ ...await importOriginal<typeof import('../src/services/imageJobClient')>(), submitImageJob: vi.fn() }));
beforeEach(() => { vi.mocked(submitImageJob).mockClear().mockResolvedValue({ images: ['/batch-result.png'] }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ images: ['/batch-result.png'] })))); });
afterEach(() => vi.unstubAllGlobals());

it.each(['generate', 'edit'])('links a batch %s result to its canvas node through the metadata-aware submission', async mode => {
  const options = { modelId: 'batch-model', model: 'batch-request-model', routeId: 'batch-route', clientLiveTaskIds: ['batch-node'] };
  const urls = mode === 'generate' ? await generateImage(undefined, 'batch', '16:9', '1k', 1, undefined, options)
    : await editImage(undefined, 'data:image/png;base64,AAAA', 'batch', '16:9', '1k', 1, undefined, options);
  expect(urls).toEqual(['/batch-result.png']);
  expect(submitImageJob).toHaveBeenLastCalledWith(expect.stringMatching(/\/generate$/), expect.objectContaining({ modelId: 'batch-model', routeId: 'batch-route', clientLiveTaskIds: ['batch-node'] }), expect.objectContaining({ 'X-Auth-Session': 'batch-session' }));
});

it('polls managed batch results with the account identity and accepts relative saved image URLs', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(submitImageJob).mockResolvedValue({ task_id: 'job-batch' });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ status: 'succeeded', images: ['/api/image-job-assets/batch.png'], data: [{ url: '/api/image-job-assets/batch.png' }] })));
    const completed = generateImage(undefined, 'batch', '1:1', '1k', 1, undefined, { clientLiveTaskIds: ['batch-node'] });
    await vi.advanceTimersByTimeAsync(2001);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/task/job-batch'), expect.objectContaining({ headers: expect.objectContaining({ 'X-Auth-Session': 'batch-session' }) }));
    expect(await completed).toEqual(['/api/image-job-assets/batch.png']);
  } finally { vi.useRealTimers(); }
});
