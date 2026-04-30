import axios from 'axios';
import { getAuthorizedBillingHeaders } from '../src/services/accountIdentity';
import { AppError, extractErrorMessage } from '../src/utils/errorDebug';

const API_BASE_URL = '/api';

const sanitizeHeader = (value: string) => value.replace(/[^\x00-\x7F]/g, '').trim();

const buildAuthHeaders = (apiKey?: string | null): Record<string, string> => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return {};

  const authorization = sanitizeHeader(
    trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}`,
  );
  return authorization ? { Authorization: authorization } : {};
};

const buildVideoRequestHeaders = async (
  apiKey?: string | null,
): Promise<Record<string, string>> => ({
  ...(await getAuthorizedBillingHeaders()),
  ...buildAuthHeaders(apiKey),
});

const toAppError = (error: any, fallback: string) =>
  new AppError(
    extractErrorMessage(error?.response?.data) || extractErrorMessage(error) || fallback,
    {
      code: String(error?.response?.data?.code || '').trim() || undefined,
      status: Number(error?.response?.data?.status || error?.response?.status) || undefined,
      traceId: String(error?.response?.data?.traceId || '').trim() || undefined,
      details: String(error?.response?.data?.details || '').trim() || undefined,
    },
  );

// Extracted polling function for reuse in recovery.
export const pollVideoTask = async (
  apiKey: string | undefined,
  taskId: string,
  onProgress?: (progress: number) => void,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const startTime = Date.now();
    let errorCount = 0;

    // Safety timeout: 15 minutes.
    const maxDuration = 15 * 60 * 1000;

    const pollInterval = setInterval(async () => {
      if (Date.now() - startTime > maxDuration) {
        clearInterval(pollInterval);
        reject(new Error('任务等待超时'));
        return;
      }

      try {
        const headers = await buildVideoRequestHeaders(apiKey);
        const pollRes = await axios.get(`${API_BASE_URL}/video/task/${taskId}`, {
          headers,
        });

        const task = pollRes.data;
        const status = (
          task.state ||
          task.status ||
          task?.data?.status ||
          ''
        ).toLowerCase();
        const outputUrl = task.image_url || task.video_url || task.url || task.data?.output;
        const failReason =
          task.fail_reason ||
          task.error ||
          task?.data?.fail_reason ||
          task?.data?.error ||
          '';
        const progressStr = String(task.progress ?? task?.data?.progress ?? '');

        const elapsed = (Date.now() - startTime) / 1000;
        const fakeProgress = Math.min(95, Math.floor(elapsed / 2));
        if (onProgress) onProgress(fakeProgress);

        if (status === 'succeeded' || status === 'completed' || status === 'success') {
          clearInterval(pollInterval);
          if (outputUrl) {
            resolve(outputUrl);
          } else {
            reject(new Error('任务已完成但未返回视频地址'));
          }
          return;
        }

        if (status === 'failed' || status === 'failure' || status === 'error') {
          clearInterval(pollInterval);
          reject(new Error(String(failReason || '视频生成失败')));
          return;
        }

        if (progressStr === '100%' && !outputUrl) {
          clearInterval(pollInterval);
          reject(new Error(String(failReason || '视频生成失败')));
          return;
        }

        if (
          status === 'processing' ||
          status === 'starting' ||
          status === 'pending' ||
          status === 'queued'
        ) {
          errorCount = 0;
        } else {
          console.warn(`[VideoPoll] Unknown status: ${status}`, task);
        }
      } catch (err: any) {
        console.warn('Poll error', err);
        if (err.response && err.response.status === 404) {
          clearInterval(pollInterval);
          reject(new Error('任务不存在或已过期'));
          return;
        }

        errorCount++;
        if (errorCount > 20) {
          clearInterval(pollInterval);
          reject(toAppError(err, '查询任务失败，请稍后重试'));
        }
      }
    }, 3000);
  });

export const generateVideo = async (
  apiKey: string | undefined,
  model: string,
  prompt: string,
  images: string[] | undefined,
  onProgress?: (progress: number) => void,
  options?: {
    modelId?: string;
    routeId?: string;
    aspect_ratio?: string;
    hd?: boolean;
    duration?: string;
  },
): Promise<string> => {
  try {
    const payload: any = { model, prompt };
    if (options?.modelId) payload.modelId = options.modelId;
    if (options?.routeId) payload.routeId = options.routeId;
    const normalizedModel = String(model || '').toLowerCase();
    const veoFirstLastModels = new Set([
      'veo3.1-fast',
      'veo3.1-pro',
      'veo3.1-pro-4k',
      'veo3.1-fast-4k',
    ]);

    if (model.startsWith('veo')) {
      const durationNum = Number.parseInt(String(options?.duration ?? '8'), 10);
      const normalizedDuration = Number.isFinite(durationNum) ? durationNum : 8;
      const is4kLike = /4k/i.test(model) || model === 'veo3.1-pro';
      const targetAspectRatio = options?.aspect_ratio || '16:9';

      payload.input_config = {
        aspect_ratio: targetAspectRatio,
        duration: normalizedDuration,
        generate_audio: true,
        resolution: is4kLike ? '4k' : '1080p',
      };

      // Compatibility: some upstream channels read top-level ratio fields.
      payload.aspect_ratio = targetAspectRatio;
      payload.ratio = targetAspectRatio;

      // Components family keeps multi-image capability.
      if (normalizedModel.includes('components')) {
        if (images && images.length > 0) {
          payload.input_config.image = images[0];
          payload.image = images[0];
        }
        if (images && images.length > 1) {
          payload.images = images;
        }
      } else if (veoFirstLastModels.has(normalizedModel)) {
        // Explicit first/last-frame models.
        if (images && images.length > 0) {
          payload.input_config.image = images[0];
          payload.image = images[0];
        }
        if (images && images.length > 1) {
          payload.input_config.last_frame = images[1];
          payload.last_frame = images[1];
          payload.images = [images[0], images[1]];
        }
      } else if (images && images.length > 0) {
        // Fallback: single reference image.
        payload.input_config.image = images[0];
        payload.image = images[0];
      }
    } else if (model.startsWith('grok-video')) {
      Object.assign(payload, options);
      if (options?.aspect_ratio) {
        payload.ratio = options.aspect_ratio;
        delete payload.aspect_ratio;
      }
      payload.resolution = options?.hd ? '1080P' : '720P';
      delete payload.hd;
      if (options?.duration) {
        payload.duration = parseInt(options.duration, 10);
      }
      if (images && images.length > 0) {
        payload.images = [images[0]];
      }
    } else {
      Object.assign(payload, options);
      if (images && images.length > 0) {
        payload.image = images[0];
      }
    }

    const headers = await buildVideoRequestHeaders(apiKey);
    const response = await axios.post(`${API_BASE_URL}/video/generate`, payload, {
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
    });

    const taskId = response?.data?.id || response?.data?.task_id || response?.data?.data?.task_id;
    if (!taskId) {
      throw new Error('未返回任务 ID');
    }

    return pollVideoTask(apiKey, taskId, onProgress);
  } catch (error: any) {
    throw toAppError(error, '视频生成请求失败');
  }
};
