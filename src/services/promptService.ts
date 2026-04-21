import axios from 'axios';

const API_BASE_URL = '/api';

export interface PromptOption {
  style: string;
  prompt: string;
}

export const optimizePrompt = async (apiKey: string, prompt: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE'): Promise<PromptOption[]> => {
  try {
    const response = await axios.post(`${API_BASE_URL}/optimize-prompt`, { prompt, type }, {
      headers: { 'Authorization': apiKey }
    });
    
    if (response.data.success && response.data.options) {
      return response.data.options;
    }
    throw new Error("Invalid response format");
  } catch (error: any) {
    throw new Error(error.response?.data?.error || "提示词优化失败");
  }
};

export const reversePrompt = async (apiKey: string, imageBase64: string): Promise<string> => {
  try {
    const response = await axios.post(`${API_BASE_URL}/reverse-prompt`, { image: imageBase64 }, {
      headers: { 'Authorization': apiKey }
    });
    
    if (response.data.success && response.data.prompt) {
      return response.data.prompt;
    }
    throw new Error("Invalid response format");
  } catch (error: any) {
    throw new Error(error.response?.data?.error || "图片逆推失败");
  }
};
