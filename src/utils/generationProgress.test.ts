import { describe, expect, it } from 'vitest';
import { NodeData } from '../../types';
import { getGenerationProgress, readTaskProgress } from './generationProgress';

const startedAt = 1_790_000_000_000;
const pending = (updates: Partial<NodeData> = {}): NodeData => ({
  id: 'image', type: 'IMAGE', x: 0, y: 0, width: 512, height: 512,
  loading: true, taskId: 'task', generationStartedAt: startedAt, ...updates,
});

describe('reported task progress', () => {
  it.each([
    [{ progress: 65 }, 65],
    [{ data: { progress: ' 65% ' } }, 65],
    [{ data: { data: { percentage: '42.5' } } }, 42.5],
    [{ task: { percent: 23 } }, 23],
  ])('normalizes the task response %j', (payload, expected) => {
    expect(readTaskProgress(payload)).toBe(expected);
  });

  it.each([0, 100, -1, 101, null, false, '', '65oops', 'NaN', Infinity, {}])(
    'ignores placeholder or invalid progress %j', (progress) => {
      expect(readTaskProgress({ progress })).toBeUndefined();
    },
  );
});

describe('canvas generation feedback', () => {
  it('uses reliable reported progress and shows elapsed time alongside it', () => {
    const view = getGenerationProgress(pending({ progress: 65, progressSource: 'reported' }), startedAt + 48_000);
    expect(view).toMatchObject({ percent: 65, percentLabel: '65%', elapsedLabel: '已等待 00:48', statusText: '正在生成图片' });
  });

  it('marks legacy simulated progress as estimated and caps the waiting display at 95%', () => {
    const view = getGenerationProgress(pending({ progress: 99, progressSource: 'estimated' }), startedAt + 29 * 60_000);
    expect(view.percent).toBe(95);
    expect(view.percentLabel).toBe('预计 95%');
    expect(view.statusText).toBe('生成耗时较长，仍在等待结果');
  });

  it('derives continuous estimates from the original start time after remount or refresh', () => {
    const node = pending();
    const early = getGenerationProgress(node, startedAt + 10_000);
    const restored = getGenerationProgress(JSON.parse(JSON.stringify(node)), startedAt + 80_000);
    expect(restored.percent).toBeGreaterThan(early.percent);
    expect(restored.elapsedLabel).toBe('已等待 01:20');
    expect(restored).toEqual(getGenerationProgress(node, startedAt + 80_000));
  });

  it('continues estimating while a synchronous submission has no task ID', () => {
    const view = getGenerationProgress(pending({ taskId: undefined }), startedAt + 80_000);
    expect(view.percent).toBeGreaterThan(10);
    expect(view.statusText).toBe('正在提交，等待服务器确认');
  });

  it('shows accepted video generation when the service owns the task ID', () => {
    const view = getGenerationProgress(pending({ type: 'VIDEO', taskId: undefined, generationStatus: 'PENDING' }), startedAt + 20_000);
    expect(view.statusText).toBe('正在生成视频');
  });

  it('only shows queue text for an explicit queue status', () => {
    expect(getGenerationProgress(pending({ generationStatus: 'QUEUED' }), startedAt + 20_000).statusText).toBe('正在排队，等待开始生成');
    expect(getGenerationProgress(pending({ generationStatus: 'PENDING' }), startedAt + 20_000).statusText).toBe('正在生成图片');
  });

  it('keeps the percentage while explaining durable task connection recovery', () => {
    const view = getGenerationProgress(pending({ taskId: 'job-a', progress: 65, progressSource: 'reported', generationConnectionStatus: 'recovering' }), startedAt + 20_000);
    expect(view.percentLabel).toBe('65%');
    expect(view.statusText).toBe('连接中断，正在恢复任务');
    expect(getGenerationProgress(pending({ taskId: 'request-a', generationConnectionStatus: 'unconfirmed' }), startedAt + 20_000).statusText)
      .toBe('尚未确认受理，请核对历史记录');
  });

  it('never presents 100% while waiting, including a success status without a result', () => {
    const view = getGenerationProgress(pending({ progress: 100, progressSource: 'reported', generationStatus: 'SUCCESS' }), startedAt + 80_000);
    expect(view.percent).toBeLessThan(100);
    expect(view.percentLabel).toContain('预计');
  });

  it('does not show a failed task with backend progress 100 as completed', () => {
    const view = getGenerationProgress(pending({ error: true, loading: false, progress: 100 }), startedAt + 80_000);
    expect(view.percent).toBe(0);
    expect(view.statusText).toBe('生成失败');
  });

  it('finishes when generation has returned a usable image', () => {
    expect(getGenerationProgress(pending({ loading: false, src: '/generated-assets/image.png' }), startedAt + 80_000))
      .toMatchObject({ percent: 100, percentLabel: '100%', statusText: '生成完成' });
  });

  it('handles a future start time without negative elapsed time', () => {
    expect(getGenerationProgress(pending(), startedAt - 1000).elapsedLabel).toBe('已等待 00:00');
  });
});
