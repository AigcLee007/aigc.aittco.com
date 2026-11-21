import type { BatchGenerationTask } from './batchGenerationTypes';

type BatchTaskProcessor = (task: BatchGenerationTask) => Promise<void>;

interface ActiveBatchRun {
  batchId: string;
  paused: boolean;
  promise: Promise<void>;
}

export class BatchGenerationCoordinator {
  private activeRun: ActiveBatchRun | null = null;

  pause(batchId: string) {
    if (!this.activeRun || this.activeRun.batchId !== batchId) return false;
    this.activeRun.paused = true;
    return true;
  }

  async run(
    batchId: string,
    tasks: BatchGenerationTask[],
    concurrency: number,
    processTask: BatchTaskProcessor,
    onTaskError?: (task: BatchGenerationTask, error: unknown) => Promise<void> | void,
  ) {
    if (this.activeRun) {
      if (this.activeRun.batchId !== batchId) throw new Error('另一个批次正在运行');
      this.activeRun.paused = false;
      return this.activeRun.promise;
    }

    const queue = tasks.filter((task) => !['succeeded', 'failed'].includes(task.status));
    if (queue.length === 0) return;

    const run: ActiveBatchRun = {
      batchId,
      paused: false,
      promise: Promise.resolve(),
    };
    this.activeRun = run;

    const worker = async () => {
      while (!run.paused) {
        const task = queue.shift();
        if (!task) return;

        try {
          await processTask(task);
        } catch (error) {
          try {
            await onTaskError?.(task, error);
          } catch {
            // A task-level error reporter must not release a worker slot early.
          }
        }
      }
    };

    const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), queue.length);
    run.promise = Promise.all(Array.from({ length: workerCount }, () => worker()))
      .then(() => undefined)
      .finally(() => {
        if (this.activeRun === run) this.activeRun = null;
      });

    return run.promise;
  }

  getActiveBatchId() {
    return this.activeRun?.batchId || null;
  }

  isPaused(batchId: string) {
    return this.activeRun?.batchId === batchId && this.activeRun.paused;
  }
}
