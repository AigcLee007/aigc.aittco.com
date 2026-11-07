const GPT_IMAGE_ANIMATION_ROUTE_ID = 'gpt-image-2.6-sunburst-osodm-1k';
const isGptImageAnimationRoute = (route = {}) => route.id === GPT_IMAGE_ANIMATION_ROUTE_ID;
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

const getGptImageAnimationFields = (route = {}, body = {}) => {
  const format = String(body.output_format || 'png').toLowerCase();
  if (!isGptImageAnimationRoute(route)) {
    if (format === 'gif') invalid('GIF 动图请使用动态图片线路');
    return {};
  }
  const size = String(body.image_size || body.imageSize || body.size || '1k').toLowerCase();
  if (['2k', '4k'].includes(size)) invalid('动态图片线路仅支持 1K');
  if (!['png', 'gif'].includes(format)) invalid('动态图片线路支持 PNG 和 GIF');
  if (body.quality && !['auto', 'low', 'medium', 'high'].includes(body.quality)) invalid('动态图片线路质量仅支持 low、medium、high');
  const complexity = body.complexity || 'auto';
  if (!['auto', 'low', 'medium', 'high'].includes(complexity)) invalid('复杂度仅支持 auto、low、medium、high');
  const fields = { output_format: format };
  if (complexity !== 'auto') fields.complexity = complexity;
  if (format === 'gif') {
    const count = Number(body.frame_count ?? 9);
    const duration = Number(body.frame_duration_ms ?? 200);
    if (!Number.isInteger(count) || count < 2 || count > 16) invalid('GIF 帧数必须为 2–16 的整数');
    if (!Number.isInteger(duration) || duration < 20 || duration > 2000) invalid('GIF 每帧时长必须为 20–2000ms 的整数');
    fields.frame_count = count;
    fields.frame_duration_ms = duration;
  }
  return fields;
};

const normalizeAnimationSize = size => {
  const match = String(size || '').match(/^(\d+)x(\d+)$/i);
  if (!match) return '1024x1024';
  const width = Number(match[1]), height = Number(match[2]);
  const scale = Math.min(1, Math.sqrt(1572864 / (width * height)));
  return `${Math.max(16, Math.floor(width * scale / 16) * 16)}x${Math.max(16, Math.floor(height * scale / 16) * 16)}`;
};

module.exports = { GPT_IMAGE_ANIMATION_ROUTE_ID, isGptImageAnimationRoute, getGptImageAnimationFields, normalizeAnimationSize };
