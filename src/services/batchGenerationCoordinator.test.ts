import { describe, expect, it, vi } from 'vitest';
import type { BatchGenerationTask } from './batchGenerationTypes';
import { BatchGenerationCoordinator } from './batchGenerationCoordinator';

const task = (id: string, status: BatchGenerationTask['status'] = 'pending'): BatchGenerationTask => ({
  id,
  groupId: `group-${id}`,
  prompt: `prompt-${id}`,
  referenceAssetIds: [],
  outputIndex: 0,
  requestId: `request-${id}`,
  status,
});

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('batch generation coordinator', () => {
  it('keeps the requested concurrency and starts the next pending task as a slot opens', async () => {
    const coordinator = new BatchGenerationCoordinator();
    const tasks = [task('a'), task('b'), task('c')];
    const gates = new Map(tasks.map((item) => [item.id, deferred()]));
    const started: string[] = [];
    const run = coordinator.run('batch-a', tasks, 2, async (item) => {
      started.push(item.id);
      await gates.get(item.id)!.promise;
    });

    await vi.waitFor(() => expect(started).toEqual(['a', 'b']));
    gates.get('b')!.resolve();
    await vi.waitFor(() => expect(started).toEqual(['a', 'b', 'c']));
    gates.get('a')!.resolve();
    gates.get('c')!.resolve();
    await run;
  });

  it('stops dispatch after pause and resumes pending tasks without re-running active work', async () => {
    const coordinator = new BatchGenerationCoordinator();
    const tasks = [task('a'), task('b')];
    const first = deferred();
    const started: string[] = [];
    const process = async (item: BatchGenerationTask) => {
      started.push(item.id);
      if (item.id === 'a') await first.promise;
    };

    const run = coordinator.run('batch-a', tasks, 1, process);
    await vi.waitFor(() => expect(started).toEqual(['a']));
    coordinator.pause('batch-a');
    first.resolve();
    await run;
    expect(started).toEqual(['a']);

    await coordinator.run('batch-a', tasks.filter((item) => item.id === 'b'), 1, process);
    expect(started).toEqual(['a', 'b']);
  });

  it('does not dispatch successful or failed tasks unless they were reset to pending', async () => {
    const coordinator = new BatchGenerationCoordinator();
    const started: string[] = [];

    await coordinator.run('batch-a', [task('done', 'succeeded'), task('failed', 'failed'), task('pending')], 3, async (item) => {
      started.push(item.id);
    });

    expect(started).toEqual(['pending']);
  });

  it('prevents another batch from starting while one batch still has active work', async () => {
    const coordinator = new BatchGenerationCoordinator();
    const active = deferred();
    const run = coordinator.run('batch-a', [task('a')], 1, async () => active.promise);
    await expect(coordinator.run('batch-b', [task('b')], 1, async () => {})).rejects.toThrow('正在运行');
    active.resolve();
    await run;
  });
});
