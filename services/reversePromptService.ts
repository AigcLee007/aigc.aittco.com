//const BACKEND_URL = 'http://localhost:3002';
// 鑷姩鍒ゆ柇鐜锛氭湰鍦板紑鍙戠敤 3323锛岀嚎涓婇儴缃茬敤鐩稿璺緞// 鑷姩鍒ゆ柇鐜
const BACKEND_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:3355'
  : '';

interface ReversePromptResponse {
    success: boolean;
    prompt?: string;
    error?: string;
}

/**
 * 灏嗘枃浠惰浆鎹负 Base64 瀛楃涓? */
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
};

/**
 * 璋冪敤鍚庣 API 杩涜鍥剧墖閫嗘帹鎻愮ず璇? * @param apiKey 鐢ㄦ埛鐨?API Key
 * @param imageFile 涓婁紶鐨勫浘鐗囨枃浠? * @returns 閫嗘帹鐢熸垚鐨勬彁绀鸿瘝
 */
export async function reversePrompt(apiKey: string, imageFile: File): Promise<string> {
    if (!apiKey) {
        throw new Error('API Key 涓嶈兘涓虹┖');
    }
    if (!imageFile) {
        throw new Error('璇峰厛閫夋嫨鍥剧墖');
    }

    // 楠岃瘉鏂囦欢绫诲瀷
    if (!imageFile.type.startsWith('image/')) {
        throw new Error('璇蜂笂浼犳湁鏁堢殑鍥剧墖鏂囦欢');
    }

    // 楠岃瘉鏂囦欢澶у皬 (渚嬪闄愬埗 4MB, Gemini API 鏈夐檺鍒?
    if (imageFile.size > 4 * 1024 * 1024) {
        throw new Error('鍥剧墖澶у皬涓嶈兘瓒呰繃 4MB');
    }

    try {
        const base64Image = await fileToBase64(imageFile);

        const response = await fetch(`${BACKEND_URL}/api/reverse-prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ image: base64Image })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `璇锋眰澶辫触: ${response.status}`);
        }

        const data: ReversePromptResponse = await response.json();

        if (!data.success || !data.prompt) {
            throw new Error(data.error || '閫嗘帹澶辫触锛氭湭杩斿洖缁撴灉');
        }

        return data.prompt;
    } catch (error: any) {
        if (error.message.includes('fetch')) {
            throw new Error('杩炴帴澶辫触锛氳纭繚鍚庣鏈嶅姟姝ｅ湪杩愯 (绔彛 3325)');
        }
        throw error;
    }
}

