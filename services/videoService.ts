import axios from 'axios';
import { getAuthorizedBillingHeaders } from '../src/services/accountIdentity';
import { AppError, extractErrorMessage } from '../src/utils/errorDebug';

const API_BASE_URL = '/api';
export const VIDEO_POLL_INTERVAL_MS = 12_000;
export const VIDEO_POLL_DEADLINE_MS = 30 * 60 * 1000;

export interface GenerateVideoInput {
  modelId: string;
  routeId: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  duration: string | number;
  referenceImages?: string[];
  referenceVideos?: string[];
}

export interface InternalVideoRequest {
  modelId: string;
  routeId: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  referenceImages: string[];
  referenceVideos: string[];
}

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

const dedupeStrings = (values?: string[]) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

export const buildInternalVideoRequest = (
  input: GenerateVideoInput,
): InternalVideoRequest => ({
  modelId: String(input.modelId || '').trim(),
  routeId: String(input.routeId || '').trim(),
  prompt: String(input.prompt || '').trim(),
  aspectRatio: String(input.aspectRatio || '').trim(),
  resolution: String(input.resolution || '').trim(),
  duration: Number(input.duration),
  referenceImages: dedupeStrings(input.referenceImages),
  referenceVideos: dedupeStrings(input.referenceVideos),
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

export const pollVideoTask = async (
  apiKey: string | undefined,
  taskId: string,
  onProgress?: (progress: number) => void,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const startTime = Date.now();
    let errorCount = 0;
    const pollInterval = setInterval(async () => {
      if (Date.now() - startTime > VIDEO_POLL_DEADLINE_MS) {
        clearInterval(pollInterval);
        reject(new Error('任务等待超时'));
        return;
      }

      try {
        const headers = await buildVideoRequestHeaders(apiKey);
        const pollRes = await axios.get(`${API_BASE_URL}/video/task/${taskId}`, { headers });
        const task = pollRes.data;
        const status = (task.state || task.status || task?.data?.status || '').toLowerCase();
        const outputUrl = task.image_url || task.video_url || task.url || task.data?.output;
        const failReason = task.fail_reason || task.error || task?.data?.fail_reason || task?.data?.error || '';
        const progressStr = String(task.progress ?? task?.data?.progress ?? '');

        if (onProgress) {
          onProgress(Math.min(95, Math.floor((Date.now() - startTime) / 2000)));
        }

        if (status === 'succeeded' || status === 'completed' || status === 'success') {
          clearInterval(pollInterval);
          if (outputUrl) resolve(outputUrl);
          else reject(new Error('任务已完成但未返回视频地址'));
          return;
        }

        if (status === 'failed' || status === 'failure' || status === 'error' || (progressStr === '100%' && !outputUrl)) {
          clearInterval(pollInterval);
          reject(new Error(String(failReason || '视频生成失败')));
          return;
        }

        if (['processing', 'starting', 'pending', 'queued'].includes(status)) {
          errorCount = 0;
        } else {
          console.warn(`[VideoPoll] Unknown status: ${status}`, task);
        }
      } catch (err: any) {
        console.warn('Poll error', err);
        if (err.response?.status === 404) {
          clearInterval(pollInterval);
          reject(new Error('未找到视频生成任务'));
          return;
        }

        errorCount += 1;
        if (errorCount > 20) {
          clearInterval(pollInterval);
          reject(toAppError(err, '查询任务失败，请稍后重试'));
        }
      }
    }, VIDEO_POLL_INTERVAL_MS);
  });

export const generateVideo = async (
  apiKey: string | undefined,
  input: GenerateVideoInput,
  onProgress?: (progress: number) => void,
): Promise<string> => {
  try {
    const headers = await buildVideoRequestHeaders(apiKey);
    const response = await axios.post(
      `${API_BASE_URL}/video/generate`,
      buildInternalVideoRequest(input),
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    );
    const taskId = response?.data?.id || response?.data?.task_id || response?.data?.data?.task_id;
    if (!taskId) throw new Error('未返回任务 ID');
    return pollVideoTask(apiKey, taskId, onProgress);
  } catch (error: any) {
    throw toAppError(error, '视频生成请求失败');
  }
};
