import type { ImageRouteConfig } from './imageRoutes';

export const isGptImageAnimationRoute = (route: Pick<ImageRouteConfig, 'id'>) =>
  route.id === 'gpt-image-2.6-sunburst-osodm-1k';

export function getGptImageAnimationFields(route: ImageRouteConfig, settings: {
  image_size: string;
  output_format: 'png' | 'gif';
  complexity: 'auto' | 'low' | 'medium' | 'high';
  frame_count: number;
  frame_duration_ms: number;
}): Record<string, string | number> {
  if (!isGptImageAnimationRoute(route)) return {};
  if (settings.image_size.toLowerCase() !== '1k') throw new Error('动态图片线路仅支持 1K');
  const fields: Record<string, string | number> = { output_format: settings.output_format };
  if (settings.complexity !== 'auto') fields.complexity = settings.complexity;
  if (settings.output_format === 'gif') {
    if (!Number.isInteger(settings.frame_count) || settings.frame_count < 2 || settings.frame_count > 16) {
      throw new Error('GIF 帧数必须为 2–16 的整数');
    }
    if (!Number.isInteger(settings.frame_duration_ms) || settings.frame_duration_ms < 20 || settings.frame_duration_ms > 2000) {
      throw new Error('GIF 每帧时长必须为 20–2000ms 的整数');
    }
    fields.frame_count = settings.frame_count;
    fields.frame_duration_ms = settings.frame_duration_ms;
  }
  return fields;
}
