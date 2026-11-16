import { calculateGptImageSize } from './imageUtils';

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
  quality,
  output_format: 'png',
  moderation: 'auto',
  n,
  routeId,
  ...(routeId === 'seedream-5-pro-visionary-stable' ? { aspect_ratio: aspectRatio } : {}),
});
