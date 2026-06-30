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

const PUBLIC_VIDEO_API_MODELS = new Set([
  'kling-video-3.0',
  'kling-video-o3-omni',
  'sora2',
  'sora-v3-pro',
  'sora-v3-fast',
  'veo31-fast',
]);

const VEO_FIRST_LAST_MODELS = new Set([
  'veo3.1-fast',
  'veo3.1-pro',
  'veo3.1-pro-4k',
  'veo3.1-fast-4k',
]);

export const normalizeVideoReferences = (images: string[] | undefined) => {
  const refs = (Array.isArray(images) ? images : [])
    .map((value) => {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) return trimmed;
      return `data:image/jpeg;base64,${trimmed}`;
    })
    .filter(Boolean);
  return Array.from(new Set(refs));
};

export const getVideoReferenceLimit = (model: string) => {
  const normalized = String(model || '').trim().toLowerCase();
  if (normalized === 'kling-video-3.0') return 1;
  if (normalized === 'kling-video-o3-omni') return 7;
  if (normalized === 'sora2') return 1;
  if (normalized === 'sora-v3-pro' || normalized === 'sora-v3-fast') return 4;
  if (normalized === 'veo31-fast') return 1;
  if (normalized === 'veo3.1-fast' || normalized === 'veo3.1-pro' || normalized === 'veo3.1-pro-4k' || normalized === 'veo3.1-fast-4k') return 2;
  if (normalized.includes('components')) return 3;
  return 1;
};

export const buildVideoReferencePayload = (model: string, images: string[] | undefined) => {
  const normalizedModel = String(model || '').trim().toLowerCase();
  const refs = normalizeVideoReferences(images);
  if (refs.length === 0) return {};

  if (normalizedModel === 'veo3.1-fast' || normalizedModel === 'veo3.1-pro' || normalizedModel === 'veo3.1-pro-4k' || normalizedModel === 'veo3.1-fast-4k') {
    return {
      start_frame: refs[0],
      ...(refs[1] ? { end_frame: refs[1] } : {}),
    };
  }

  if (
    normalizedModel === 'kling-video-3.0' ||
    normalizedModel === 'kling-video-o3-omni' ||
    normalizedModel === 'sora2' ||
    normalizedModel === 'sora-v3-pro' ||
    normalizedModel === 'sora-v3-fast' ||
    normalizedModel === 'veo31-fast' ||
    normalizedModel.includes('components')
  ) {
    return {
      image_urls: refs.slice(0, getVideoReferenceLimit(normalizedModel)),
    };
  }

  return { image_urls: refs.slice(0, 1) };
};

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

    if (PUBLIC_VIDEO_API_MODELS.has(normalizedModel)) {
      payload.aspect_ratio = options?.aspect_ratio || '16:9';
      payload.duration = Number.parseInt(String(options?.duration || '5'), 10);
      payload.resolution = normalizedModel === 'veo31-fast' ? (options?.hd === false ? '720p' : '1080p') : normalizedModel === 'sora2' || normalizedModel === 'sora-v3-pro' || normalizedModel === 'sora-v3-fast' ? '720p' : options?.hd === false ? '720p' : '1080p';
      payload.generate_audio = true;
      Object.assign(payload, buildVideoReferencePayload(normalizedModel, images));
    } else if (model.startsWith('veo')) {
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
        const refs = normalizeVideoReferences(images);
        if (refs.length > 0) {
          payload.input_config.image = refs[0];
          payload.image = refs[0];
        }
        if (refs.length > 1) {
          payload.images = refs.slice(0, getVideoReferenceLimit(normalizedModel));
          payload.image_urls = payload.images;
        }
      } else if (VEO_FIRST_LAST_MODELS.has(normalizedModel)) {
        // Explicit first/last-frame models.
        const refs = normalizeVideoReferences(images);
        if (refs.length > 0) {
          payload.input_config.image = refs[0];
          payload.image = refs[0];
          payload.start_frame = refs[0];
        }
        if (refs.length > 1) {
          payload.input_config.last_frame = refs[1];
          payload.last_frame = refs[1];
          payload.end_frame = refs[1];
          payload.images = [refs[0], refs[1]];
        }
      } else if (images && images.length > 0) {
        // Fallback: single reference image.
        const refs = normalizeVideoReferences(images);
        payload.input_config.image = refs[0];
        payload.image = refs[0];
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
      const refs = normalizeVideoReferences(images);
      if (refs.length > 0) {
        payload.images = [refs[0]];
        payload.image = refs[0];
      }
    } else {
      Object.assign(payload, options);
      const refs = normalizeVideoReferences(images);
      if (refs.length > 0) {
        payload.image = refs[0];
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
