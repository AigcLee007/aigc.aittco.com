import { buildBillingIdentityHeaders, getStoredAuthSessionToken } from './accountIdentity';
import { submitImageJob } from './imageJobClient';
import { AppError, extractErrorMessage } from '../utils/errorDebug';

export interface UpscaleEngine {
  id: string;
  label: string;
  description: string;
  factors: number[];
  maxInputPixels: number | null;
  maxOutputPixels: number | null;
  /** Factors that work for the image size asked about; empty means this engine cannot take the image. */
  usableFactors?: number[];
  defaultFactor?: number | null;
  /** Output formats the user may choose; null when the engine has a fixed format. */
  formats?: string[] | null;
  /** Formats still allowed at each usable factor (PNG drops out for very large outputs). */
  formatsByFactor?: Record<string, string[]> | null;
}

export interface UpscaleOptions {
  enabled: boolean;
  engines: UpscaleEngine[];
}

export interface UpscaleQuote {
  engine: string;
  factor: number;
  format: string | null;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  points: number;
}

const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';

const readJson = async (response: Response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AppError(extractErrorMessage(data) || `请求失败 (${response.status})`, {
      status: response.status,
      code: typeof data?.code === 'string' ? data.code : undefined,
    });
  }
  return data;
};

export const fetchUpscaleOptions = async (size?: { width: number; height: number }): Promise<UpscaleOptions> =>
  readJson(await fetch(`${API_BASE_URL}/upscale/options${size ? `?width=${size.width}&height=${size.height}` : ''}`));

export const fetchUpscaleQuote = async (
  input: { engine: string; factor: number; format?: string | null; width: number; height: number },
): Promise<UpscaleQuote> =>
  readJson(await fetch(`${API_BASE_URL}/upscale/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));

// Submits a durable upscale job. The caller gets a task id to poll, exactly like a generation.
export const submitUpscale = async (
  payload: { image: string; engine: string; factor: number; format?: string | null; clientLiveTaskIds?: string[] },
): Promise<{ taskId: string; [key: string]: any }> => {
  const session = getStoredAuthSessionToken();
  if (!session) throw new AppError('请先登录后再使用高清放大', { status: 401 });
  const headers = { ...buildBillingIdentityHeaders(session), 'Content-Type': 'application/json' };
  const result = await submitImageJob(`${API_BASE_URL}/upscale`, payload, headers);
  const taskId = result?.task_id || result?.id;
  if (!taskId) throw new AppError('未返回任务编号，请稍后在历史记录中核对');
  return { ...result, taskId };
};
