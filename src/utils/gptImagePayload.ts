import { calculateGptImageSize } from './imageUtils';

const isSeedreamVisionaryStableRoute = (routeId: string) =>
  /^seedream-.+-visionary-stable$/i.test(String(routeId || '').trim());

interface GptImagePayloadOptions {
  model: string;
  modelId: string;
  prompt: string;
  imageSize: string;
  aspectRatio: string;
  quality: string;
  n: number;
  routeId: string;
}

export const buildGptImagePayload = ({
  model,
  modelId,
  prompt,
  imageSize,
  aspectRatio,
  quality,
  n,
  routeId,
}: GptImagePayloadOptions) => ({
  model,
  modelId,
  prompt,
  size: calculateGptImageSize(imageSize, aspectRatio),
  image_size: imageSize,
  ...(modelId.toLowerCase().startsWith('seedream-') ? {} : { quality }),
  output_format: 'png',
  moderation: 'auto',
  n,
  routeId,
  ...(isSeedreamVisionaryStableRoute(routeId) ? { aspect_ratio: aspectRatio } : {}),
});
