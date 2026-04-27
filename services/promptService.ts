import {
  AUTH_SESSION_CHANGE_EVENT,
  getAuthorizedBillingHeaders,
} from '../src/services/accountIdentity';

const BACKEND_URL = '/api';

export interface PromptOption {
  style: string;
  prompt: string;
}

export interface OptimizePromptResponse {
  success: boolean;
  options?: PromptOption[];
  model?: string;
  cost?: number;
  billing?: {
    deductedPoints?: number;
    remainingPoints?: number;
  };
  error?: string;
}

export interface PromptToolConfig {
  success: boolean;
  model: string;
  optimizeCost: number;
  reverseCost: number;
}

export async function fetchPromptToolConfig(): Promise<PromptToolConfig> {
  const response = await fetch(`${BACKEND_URL}/prompt-tools/config`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const data = (await response.json().catch(() => ({}))) as Partial<PromptToolConfig> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error || '读取提示词工具配置失败');
  }
  return {
    success: data.success !== false,
    model: String(data.model || 'gemini-3.1-pro-preview'),
    optimizeCost: Number(data.optimizeCost ?? 0.5),
    reverseCost: Number(data.reverseCost ?? 1),
  };
}

export async function optimizePrompt(
  prompt: string,
  type: 'IMAGE' | 'VIDEO' = 'IMAGE',
): Promise<PromptOption[]> {
  if (!prompt.trim()) {
    throw new Error('请先输入提示词');
  }

  try {
    const response = await fetch(`${BACKEND_URL}/optimize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
      body: JSON.stringify({ prompt: prompt.trim(), type }),
    });

    const data: OptimizePromptResponse = await response.json().catch(() => ({
      success: false,
      error: '优化请求失败',
    }));

    if (!response.ok) {
      throw new Error(data.error || `请求失败: ${response.status}`);
    }

    if (!data.success || !data.options || data.options.length === 0) {
      throw new Error(data.error || '优化失败：未返回结果');
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGE_EVENT));
    }

    return data.options;
  } catch (error: any) {
    if (String(error?.message || '').includes('fetch')) {
      throw new Error('连接失败：请确认后端服务正在运行');
    }
    throw error;
  }
}
