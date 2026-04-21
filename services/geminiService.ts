import { getAuthorizedBillingHeaders } from '../src/services/accountIdentity';

import { formatPoint } from '../src/utils/pointFormat';

// API configuration
// Production should use the relative /api path; local development uses http://localhost:3355/api.
const API_BASE_URL = typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3355/api'
    : '/api';
// Helper to determine model based on size
const getModelBySize = (size: string): string => {
    switch (size.toLowerCase()) {
        case '4k': return 'nano-banana-2-4k';
        case '2k': return 'nano-banana-2-2k';
        case '1k':
        default: return 'nano-banana-2';
    }
};

// Helper to wait between polling requests
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const cleanUrl = (url: string) => url.replace(/\/$/, "");
const sanitizeHeader = (value: string) => value.replace(/[^\x20-\x7E]/g, '').trim();
const buildAuthHeaders = (apiKey?: string | null): Record<string, string> => {
    const trimmed = String(apiKey || '').trim();
    if (!trimmed) return {};
    const authHeader = sanitizeHeader(trimmed.startsWith('Bearer ') ? trimmed : `Bearer ${trimmed}`);
    if (!authHeader) return {};
    return { Authorization: authHeader };
};

// Helper to extract raw Base64 from data URL
const extractBase64 = (dataUrl: string) => {
    if (dataUrl.includes(',')) {
        return dataUrl.split(',')[1];
    }
    return dataUrl;
};

// Recursive function to find ALL URLs in the object
function findAllUrlsInObject(obj: any, results: string[] = []) {
    if (!obj) return;

    if (Array.isArray(obj)) {
        obj.forEach(item => findAllUrlsInObject(item, results));
        return;
    }

    if (typeof obj !== 'object') return;

    if (obj.output && typeof obj.output === 'string' && (obj.output.startsWith('http') || obj.output.startsWith('data:'))) {
        results.push(obj.output);
    }
    else if (obj.url && typeof obj.url === 'string' && (obj.url.startsWith('http') || obj.url.startsWith('data:'))) {
        results.push(obj.url);
    }
    else if (obj.image_url && typeof obj.image_url === 'string' && (obj.image_url.startsWith('http') || obj.image_url.startsWith('data:'))) {
        results.push(obj.image_url);
    }

    for (let key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const val = obj[key];
            if (typeof val === 'object') {
                findAllUrlsInObject(val, results);
            }
        }
    }
}

function findStatusInObject(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.status && typeof obj.status === 'string') return obj.status;
    if (obj.state && typeof obj.state === 'string') return obj.state;
    if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
    return null;
}

// Poll generation tasks through the backend proxy.
const pollTask = async (apiKey: string | undefined, taskId: string, onProgress?: (progress: number) => void): Promise<string[]> => {
  const url = `${cleanUrl(API_BASE_URL)}/task/${taskId}`;
  const maxAttempts = 450; // 15 minutes (450 * 2s = 900s)

  const startTime = Date.now();

    for (let i = 0; i < maxAttempts; i++) {
        await sleep(2000);

        // Simulated Progress (Target 90% at 80s)
        const elapsed = (Date.now() - startTime) / 1000;
        // k ~= 0.028 so the simulated progress reaches about 90% at 80 seconds.
        const simulated = (1 - Math.exp(-0.028 * elapsed)) * 100;
        const displayProgress = Math.min(Math.floor(simulated), 99);
        if (onProgress) onProgress(displayProgress);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    ...buildAuthHeaders(apiKey),
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) continue;
                console.warn(`Polling HTTP error: ${response.status}`);
                continue;
            }

            const data = await response.json();
            console.log(`Polling [${i}/${maxAttempts}]`, data);

            let statusRaw = (data.status || data.state || "").toUpperCase();
            if (!statusRaw || statusRaw === "UNKNOWN") {
                const innerStatus = findStatusInObject(data);
                if (innerStatus) statusRaw = innerStatus.toUpperCase();
            }

            const isSuccess = statusRaw === 'SUCCESS' || statusRaw === 'SUCCEEDED' || statusRaw === 'COMPLETED';
            const isFailed = statusRaw === 'FAILURE' || statusRaw === 'FAILED';

            if (isSuccess) {
                const foundUrls: string[] = [];
                findAllUrlsInObject(data, foundUrls);
                const uniqueUrls = Array.from(new Set(foundUrls));

                if (uniqueUrls.length > 0) {
                    console.log("Images found:", uniqueUrls);
                    return uniqueUrls;
                }
            } else if (isFailed) {
                throw new Error(`Task failed: ${JSON.stringify(data)}`);
            }

        } catch (error) {
            console.warn("Polling error:", error);
        }
    }

    throw new Error("Task timed out. No images returned.");
};

// Helper to handle API errors and customize specific messages
const handleApiError = async (response: Response) => {
    const errText = await response.text();
    let errJson: any = null;

    try {
        errJson = JSON.parse(errText);
    } catch (error) {
        errJson = null;
    }

    if (errJson?.code === 'INSUFFICIENT_POINTS') {
        const currentPoints = formatPoint(errJson?.currentPoints ?? 0);
        const requiredPoints = formatPoint(errJson?.requiredPoints ?? 0);
        throw new Error(`点数不足：当前 ${currentPoints} 点，需要 ${requiredPoints} 点`);
    }

    if (errJson?.code === 'AUTH_LOGIN_REQUIRED') {
        throw new Error('请先登录后再使用点数功能');
    }

    if (errJson?.code === 'ACCOUNT_AUTH_REQUIRED') {
        throw new Error('账户验证失败，请重新登录');
    }

    if (response.status === 401) {
        throw new Error('请求未授权，请先确认登录状态或 API Key');
    }

    const lowerErr = String(errJson?.error || errText).toLowerCase();
    if (
        lowerErr.includes('token quota is not enough') ||
        (lowerErr.includes('remain quota') && lowerErr.includes('need quota')) ||
        lowerErr.includes('insufficient balance') ||
        lowerErr.includes('not enough balance') ||
        lowerErr.includes('credit') ||
        lowerErr.includes('quota')
    ) {
        throw new Error('额度不足，请充值后重试');
    }

    throw new Error(`Submission Failed (${response.status}): ${errJson?.error || errText}`);
};

// Generate images through the backend proxy
export const generateImage = async (
    apiKey: string | undefined,
    prompt: string,
    aspectRatio: string = '1:1',
    imageSize: string = '1k',
    n: number = 1,
    onProgress?: (progress: number) => void,
    options?: { routeId?: string; model?: string; modelId?: string }
): Promise<string[]> => {
    const endpoint = `${cleanUrl(API_BASE_URL)}/generate`;
    const billingHeaders = await getAuthorizedBillingHeaders();

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...billingHeaders,
            ...buildAuthHeaders(apiKey),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options?.model || getModelBySize(imageSize),
            modelId: options?.modelId,
            prompt,
            size: imageSize.toLowerCase(),
            aspect_ratio: aspectRatio,
            n,
            routeId: options?.routeId,
        }),
    });

    if (!response.ok) {
        await handleApiError(response);
    }

    const resJson = await response.json();
    if (resJson.url || resJson.image_url) {
        return [resJson.url || resJson.image_url];
    }
    if (Array.isArray(resJson.images) && resJson.images.length > 0) {
        return resJson.images;
    }
    if (Array.isArray(resJson.data) && resJson.data.length > 0) {
        return resJson.data
            .map((item: any) => {
                if (item?.url) return item.url;
                if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
                return null;
            })
            .filter((item: string | null): item is string => Boolean(item));
    }
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);

    if (!taskId) throw new Error("No Task ID received from API.");

    return await pollTask(apiKey, taskId, onProgress);
};

// Edit images through the backend proxy
export const editImage = async (
    apiKey: string | undefined,
    base64Image: string,
    prompt: string,
    aspectRatio: string = '1:1',
    imageSize: string = '1k',
    n: number = 1,
    onProgress?: (progress: number) => void,
    options?: { routeId?: string; model?: string; modelId?: string }
): Promise<string[]> => {
    const endpoint = `${cleanUrl(API_BASE_URL)}/generate`;
    const rawBase64 = extractBase64(base64Image);
    const billingHeaders = await getAuthorizedBillingHeaders();

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            ...billingHeaders,
            ...buildAuthHeaders(apiKey),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: options?.model || getModelBySize(imageSize),
            modelId: options?.modelId,
            prompt,
            size: imageSize.toLowerCase(),
            aspect_ratio: aspectRatio,
            n,
            image: rawBase64,
            routeId: options?.routeId,
        }),
    });

    if (!response.ok) {
        await handleApiError(response);
    }

    const resJson = await response.json();
    if (resJson.url || resJson.image_url) {
        return [resJson.url || resJson.image_url];
    }
    if (Array.isArray(resJson.images) && resJson.images.length > 0) {
        return resJson.images;
    }
    const taskId = resJson.id || resJson.task_id || (resJson.data && resJson.data.task_id);

    if (!taskId) throw new Error("No Task ID received from API.");

    return await pollTask(apiKey, taskId, onProgress);
};

// Check balance through the backend proxy.
export const checkBalance = async (apiKey: string): Promise<any> => {
    const authHeaders = buildAuthHeaders(apiKey);
    if (!authHeaders.Authorization) {
        throw new Error("Invalid API Key");
    }

    try {
        const response = await fetch(`${cleanUrl(API_BASE_URL)}/balance/info`, {
            method: 'GET',
            headers: authHeaders
        });

        if (!response.ok) {
            const errText = await response.text();
            let errJson;
            try { errJson = JSON.parse(errText); } catch (e) { }

            throw new Error((errJson && errJson.error) ? errJson.error : `HTTP ${response.status}: ${errText.substring(0, 50)}`);
        }

        const data = await response.json();
        return data;
    } catch (e: any) {
        throw new Error(e.message || "Failed to fetch balance");
    }
};

