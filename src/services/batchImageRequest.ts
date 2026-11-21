import type { GeminiGeneratePayload } from '../../services/api';
import {
  editImageApi,
  generateGeminiImage,
  generateImageApi,
} from '../../services/api';
import { isGptImageCompatibleModel, getImageModelEffectiveRequestSize, getImageModelRequestName } from '../config/imageModels';
import {
  getDefaultImageRouteQuality,
  getImageModelNameForRoute,
  isGeminiNativeImageRoute,
  type ImageRouteConfig,
} from '../config/imageRoutes';
import { buildGptImagePayload as buildGptRequestPayload, shouldUseVisionaryEditUpload } from '../utils/gptImagePayload';
import { normalizeImageResultValue } from '../utils/mediaProxy';
import type { BatchMode } from './batchGenerationTypes';

export interface BatchImageRequestInput {
  mode: BatchMode;
  modelId: string;
  modelName?: string;
  route: ImageRouteConfig;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
  references: string[];
}

export interface BatchImageRequest {
  endpoint: 'generate' | 'edit' | 'gemini';
  payload: Record<string, any>;
}

export interface BatchImageResponse {
  taskId?: string;
  images: string[];
}

const normalizeGeminiSize = (value: string) => {
  const normalized = String(value || '1k').trim().toUpperCase();
  return /^\d+K$/.test(normalized) ? normalized : '1K';
};

const parseReferenceDataUrl = (dataUrl: string) => {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('参考图片数据格式无效');
  return { mimeType: match[1], data: match[2] };
};

const rawImageData = (dataUrl: string) => {
  const comma = dataUrl.indexOf(',');
  return dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
};

const imageSizeForRoute = (input: BatchImageRequestInput) =>
  getImageModelEffectiveRequestSize({
    modelId: input.modelId,
    imageSize: input.imageSize,
    aspectRatio: input.aspectRatio,
  });

const modelNameForRequest = (input: BatchImageRequestInput) =>
  input.modelName || getImageModelNameForRoute({
    imageModel: input.modelId,
    imageLine: input.route.line,
    imageSize: input.imageSize,
  }) || getImageModelRequestName(input.modelId);

const buildGeminiRequest = (input: BatchImageRequestInput): BatchImageRequest => {
  const imageSize = normalizeGeminiSize(input.imageSize);
  const parts = [
    { text: input.prompt },
    ...input.references.map((reference) => ({ inlineData: parseReferenceDataUrl(reference) })),
  ];

  return {
    endpoint: 'gemini',
    payload: {
      model: modelNameForRequest(input),
      modelId: input.modelId,
      routeId: input.route.id,
      prompt: input.prompt,
      aspect_ratio: input.aspectRatio,
      image_size: imageSize,
      strict_native_config: true,
      n: 1,
      contents: [{ role: 'user', parts }],
      generationConfig: {
        imageConfig: { aspectRatio: input.aspectRatio, imageSize },
        candidateCount: 1,
      },
    },
  };
};

const buildGptImagePayload = (input: BatchImageRequestInput) =>
  buildGptRequestPayload({
    model: modelNameForRequest(input),
    modelId: input.modelId,
    prompt: input.prompt,
    imageSize: input.imageSize,
    aspectRatio: input.aspectRatio,
    quality: getDefaultImageRouteQuality(input.route),
    n: 1,
    routeId: input.route.id,
  });

export function buildBatchImageRequest(input: BatchImageRequestInput): BatchImageRequest {
  if (input.mode === 'i2i' && input.references.length === 0) {
    throw new Error('至少需要一张参考图');
  }

  if (isGeminiNativeImageRoute(input.route)) return buildGeminiRequest(input);

  if (input.mode === 'i2i') {
    const imageData = input.references.map(rawImageData);
    const requestModel = modelNameForRequest(input).toLowerCase();
    if (requestModel.startsWith('grok-')) {
      return {
        endpoint: 'generate',
        payload: {
          model: modelNameForRequest(input),
          modelId: input.modelId,
          routeId: input.route.id,
          prompt: `${input.prompt}，${input.aspectRatio}，超高品质${input.imageSize.toUpperCase()}分辨率`,
          size: imageSizeForRoute(input),
          image_size: input.imageSize,
          aspect_ratio: input.aspectRatio,
          n: 1,
          reference_mode: 'stable_fusion',
          image: imageData[0],
          images: imageData,
          reference_image: imageData[0],
          reference_images: imageData,
        },
      };
    }
    if (requestModel.startsWith('doubao')) {
      return {
        endpoint: 'generate',
        payload: {
          model: modelNameForRequest(input),
          modelId: input.modelId,
          routeId: input.route.id,
          prompt: input.prompt,
          size: imageSizeForRoute(input),
          image_size: input.imageSize,
          aspect_ratio: input.aspectRatio,
          n: 1,
          image: imageData,
        },
      };
    }
    if (isGptImageCompatibleModel(input.modelId) || shouldUseVisionaryEditUpload(input.route.id)) {
      return {
        endpoint: 'edit',
        payload: {
          ...buildGptImagePayload(input),
          images: input.references,
        },
      };
    }

    return {
      endpoint: 'generate',
      payload: {
        model: modelNameForRequest(input),
        modelId: input.modelId,
        routeId: input.route.id,
        prompt: input.prompt,
        size: imageSizeForRoute(input),
        image_size: input.imageSize,
        aspect_ratio: input.aspectRatio,
        n: 1,
        ...(imageData.length === 1 ? { image: imageData[0] } : { images: imageData }),
        referenceMode: 'legacy-collage',
      },
    };
  }

  if (isGptImageCompatibleModel(input.modelId)) {
    return { endpoint: 'generate', payload: buildGptImagePayload(input) };
  }

  return {
    endpoint: 'generate',
    payload: {
      model: modelNameForRequest(input),
      modelId: input.modelId,
      routeId: input.route.id,
      prompt: input.prompt,
      size: imageSizeForRoute(input),
      image_size: input.imageSize,
      aspect_ratio: input.aspectRatio,
      n: 1,
      ...(input.route.mode === 'sync' ? { isSync: true } : {}),
    },
  };
}

const extractCandidateImages = (response: any): string[] => {
  const images: string[] = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        images.push(`data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`);
      }
    }
  }
  return images;
};

export function normalizeBatchImageResponse(response: any): BatchImageResponse {
  const taskId = String(response?.taskId || response?.task_id || response?.id || '');
  if (/^(job-|request-)/.test(taskId)) return { taskId, images: [] };

  const images: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    const normalized = value.startsWith('data:') ? normalizeImageResultValue(value) : value;
    if (normalized && !images.includes(normalized)) images.push(normalized);
  };

  add(response?.url || response?.image_url);
  for (const image of response?.images || []) add(image);
  for (const item of response?.data || []) add(item?.url || item?.b64_json);
  for (const image of extractCandidateImages(response)) add(image);

  if (images.length === 0 && taskId) return { taskId, images };
  return { images };
}

export async function submitBatchImageRequest(
  apiKey: string | undefined,
  input: BatchImageRequestInput,
  nodeId: string,
  requestId: string,
): Promise<BatchImageResponse> {
  const request = buildBatchImageRequest(input);
  const { referenceMode, ...requestPayload } = request.payload;
  let payload: Record<string, any> = {
    ...requestPayload,
    clientRequestId: requestId,
    clientLiveTaskIds: [nodeId],
  };

  if (referenceMode === 'legacy-collage') {
    const images = input.references.map((source) => {
      const image = new Image();
      image.src = source;
      return image.decode().then(() => image);
    });
    const decoded = await Promise.all(images);
    try {
      const gap = 20;
      const height = Math.max(...decoded.map((image) => image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = decoded.reduce((width, image) => width + image.naturalWidth + gap, 0) - gap;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('参考图片拼接失败');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      let x = 0;
      for (const image of decoded) {
        context.drawImage(image, x, 0);
        x += image.naturalWidth + gap;
      }
      const collage = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
      payload = {
        ...payload,
        prompt: input.references.length > 1 ? `[多图参考] 输入是 ${input.references.length} 张图片的拼贴。${input.prompt}` : input.prompt,
        image: collage,
        images: [collage],
      };
      canvas.width = 0;
      canvas.height = 0;
    } finally {
      decoded.forEach((image) => { image.src = ''; });
    }
  }

  const response = request.endpoint === 'gemini'
    ? await generateGeminiImage(apiKey, payload as unknown as GeminiGeneratePayload)
    : request.endpoint === 'edit'
      ? await editImageApi(apiKey, payload)
      : await generateImageApi(apiKey, payload);

  return normalizeBatchImageResponse(response);
}
