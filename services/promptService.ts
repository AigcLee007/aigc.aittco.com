/**
 * Prompt Optimization Service
 * 璋冪敤 Gemini API 浼樺寲鐢ㄦ埛杈撳叆鐨勬彁绀鸿瘝锛岀敓鎴愬涓?Nano Banana Pro 鏍煎紡鐨勬柟妗? */

//const BACKEND_URL = 'http://localhost:3002';
// 鑷姩鍒ゆ柇鐜锛氭湰鍦板紑鍙戠敤 3325锛岀嚎涓婇儴缃茬敤鐩稿璺緞
const BACKEND_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3355'
  : '';

export interface PromptOption {
  style: string;
  prompt: string;
}

export interface OptimizePromptResponse {
  success: boolean;
  options?: PromptOption[];
  error?: string;
}

/**
 * 浼樺寲鎻愮ず璇? * @param apiKey - API Key
 * @param prompt - 鐢ㄦ埛杈撳叆鐨勫師濮嬫彁绀鸿瘝
 * @param type - 浼樺寲绫诲瀷 ('IMAGE' | 'VIDEO'), 榛樿 'IMAGE'
 * @returns 浼樺寲鍚庣殑鎻愮ず璇嶆柟妗堟暟缁? */
export async function optimizePrompt(apiKey: string, prompt: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE'): Promise<PromptOption[]> {
  if (!apiKey || !prompt.trim()) {
    throw new Error('API Key 鍜屾彁绀鸿瘝涓嶈兘涓虹┖');
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/optimize-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ prompt: prompt.trim(), type })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `璇锋眰澶辫触: ${response.status}`);
    }

    const data: OptimizePromptResponse = await response.json();

    if (!data.success || !data.options || data.options.length === 0) {
      throw new Error(data.error || '浼樺寲澶辫触锛氭湭杩斿洖缁撴灉');
    }

    return data.options;
  } catch (error: any) {
    if (error.message.includes('fetch')) {
      throw new Error('杩炴帴澶辫触锛氳纭繚鍚庣鏈嶅姟姝ｅ湪杩愯 (绔彛 3325)');
    }
    throw error;
  }
}


