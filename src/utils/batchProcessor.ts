/**
 * 任务对象定义
 */
export interface BatchTask {
    id: string;
    type: 'T2I' | 'I2I';
    prompt: string;
    referenceImage?: string; // 对于 I2I，单图参考
    status: 'pending' | 'processing' | 'success' | 'failed';
    result?: string;
    error?: string;
}

/**
 * 进度回调接口
 */
export interface ProgressInfo {
    total: number;
    completed: number;
    success: number;
    failed: number;
    currentTask?: BatchTask;
}

/**
 * 批量处理器
 */
export class BatchProcessor {
    private tasks: BatchTask[] = [];
    private concurrency: number;
    private onProgress: (progress: ProgressInfo) => void;
    private isRunning: boolean = false;
    private completedCount: number = 0;
    private successCount: number = 0;
    private failedCount: number = 0;

    constructor(concurrency: number = 3, onProgress: (progress: ProgressInfo) => void) {
        this.concurrency = concurrency;
        this.onProgress = onProgress;
    }

    /**
     * 添加任务
     */
    addTasks(newTasks: (Omit<BatchTask, 'status' | 'id'> & { id?: string })[]) {
        const tasksWithId = newTasks.map(t => ({
            ...t,
            id: t.id || Math.random().toString(36).substring(2, 11),
            status: 'pending' as const
        }));
        this.tasks.push(...tasksWithId);
        this.notifyProgress();
    }

    /**
     * 开始处理
     */
    async start(processor: (task: BatchTask) => Promise<any>) {
        if (this.isRunning) return;
        this.isRunning = true;

        const queue = [...this.tasks.filter(t => t.status === 'pending')];
        const activeTasks = new Set<Promise<void>>();

        const runNext = async () => {
            if (queue.length === 0 || !this.isRunning) return;

            const task = queue.shift()!;
            task.status = 'processing';
            this.notifyProgress(task);

            let promise: Promise<void>;
            const taskRunner = async () => {
                try {
                    const result = await processor(task);
                    task.status = 'success';
                    task.result = result;
                    this.successCount++;
                } catch (err) {
                    task.status = 'failed';
                    task.error = (err as Error).message;
                    this.failedCount++;
                } finally {
                    this.completedCount++;
                    this.notifyProgress();
                    if (promise) activeTasks.delete(promise);
                    await runNext();
                }
            };
            promise = taskRunner();
            activeTasks.add(promise);
        };

        // 启动初始并发
        for (let i = 0; i < Math.min(this.concurrency, queue.length); i++) {
            runNext();
        }

        // 等待所有任务完成
        while (activeTasks.size > 0) {
            await Promise.all(Array.from(activeTasks));
        }

        this.isRunning = false;
    }

    /**
     * 停止处理
     */
    stop() {
        this.isRunning = false;
    }

    /**
     * 获取当前状态
     */
    private notifyProgress(currentTask?: BatchTask) {
        this.onProgress({
            total: this.tasks.length,
            completed: this.completedCount,
            success: this.successCount,
            failed: this.failedCount,
            currentTask
        });
    }

    /**
     * 获取所有任务
     */
    getTasks() {
        return this.tasks;
    }
}
