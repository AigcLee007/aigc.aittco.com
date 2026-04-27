import {
  AUTH_SESSION_CHANGE_EVENT,
  getAuthorizedBillingHeaders,
} from '../src/services/accountIdentity';

const BACKEND_URL = '/api';

export interface ReversePromptResult {
  plainPrompt: string;
  jsonPrompt: Record<string, unknown>;
  prompt: string;
  model?: string;
  cost?: number;
  billing?: {
    deductedPoints?: number;
    remainingPoints?: number;
  };
}

interface ReversePromptResponse extends Partial<ReversePromptResult> {
  success: boolean;
  error?: string;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export async function reversePrompt(imageFile: File): Promise<ReversePromptResult> {
  if (!imageFile) {
    throw new Error('请先选择图片');
  }

  if (!imageFile.type.startsWith('image/')) {
    throw new Error('请上传有效的图片文件');
  }

  if (imageFile.size > 4 * 1024 * 1024) {
    throw new Error('图片大小不能超过 4MB');
  }

  try {
    const base64Image = await fileToBase64(imageFile);
    const response = await fetch(`${BACKEND_URL}/reverse-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getAuthorizedBillingHeaders()),
      },
      body: JSON.stringify({ image: base64Image }),
    });

    const data: ReversePromptResponse = await response.json().catch(() => ({
      success: false,
      error: '图片逆推请求失败',
    }));

    if (!response.ok) {
      throw new Error(data.error || `请求失败: ${response.status}`);
    }

    const plainPrompt = String(data.plainPrompt || data.prompt || '').trim();
    if (!data.success || !plainPrompt) {
      throw new Error(data.error || '逆推失败：未返回结果');
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGE_EVENT));
    }

    return {
      prompt: plainPrompt,
      plainPrompt,
      jsonPrompt:
        data.jsonPrompt && typeof data.jsonPrompt === 'object'
          ? data.jsonPrompt
          : { subject: plainPrompt },
      model: data.model,
      cost: data.cost,
      billing: data.billing,
    };
  } catch (error: any) {
    if (String(error?.message || '').includes('fetch')) {
      throw new Error('连接失败：请确认后端服务正在运行');
    }
    throw error;
  }
}
