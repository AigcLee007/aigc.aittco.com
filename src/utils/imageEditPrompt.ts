export type ImageEditType =
  | 'replace'
  | 'erase'
  | 'background'
  | 'restyle'
  | 'retouch';

export interface ImageEditTypeOption {
  value: ImageEditType;
  label: string;
  description: string;
}

export const IMAGE_EDIT_TYPE_OPTIONS: ImageEditTypeOption[] = [
  {
    value: 'replace',
    label: '局部替换',
    description: '只修改遮罩区域，替换成你描述的新内容。',
  },
  {
    value: 'erase',
    label: '擦除物体',
    description: '删除遮罩对象，并自然补全周围背景。',
  },
  {
    value: 'background',
    label: '换背景',
    description: '尽量保持主体不变，只重绘背景氛围。',
  },
  {
    value: 'restyle',
    label: '风格调整',
    description: '保持结构，用提示词改变遮罩区域风格与质感。',
  },
  {
    value: 'retouch',
    label: '修复细节',
    description: '修脸、修手、修边缘、修瑕疵。',
  },
];

const normalizePrompt = (value: string) => String(value || '').trim();

export const getDefaultEditPromptPlaceholder = (type: ImageEditType) => {
  switch (type) {
    case 'replace':
      return '例如：改成一只白猫，保持柔和侧光和油画质感';
    case 'erase':
      return '例如：去掉路人 / 去掉桌上的杯子';
    case 'background':
      return '例如：改成黄昏花园，暖金色逆光';
    case 'restyle':
      return '例如：改成电影级写实风格，柔和景深';
    case 'retouch':
    default:
      return '例如：修复脸部细节，让手部更自然';
  }
};

export const buildImageEditPrompt = (type: ImageEditType, rawPrompt: string) => {
  const prompt = normalizePrompt(rawPrompt);

  switch (type) {
    case 'replace':
      return prompt
        ? `Only change the masked area. Replace it with: ${prompt}. Preserve the unmasked area, lighting, perspective, and overall composition.`
        : 'Only change the masked area. Replace it with new content that fits the scene naturally. Preserve the unmasked area, lighting, perspective, and overall composition.';
    case 'erase':
      return prompt
        ? `Remove the masked object or region. ${prompt}. Fill the area naturally using the surrounding scene. Preserve the unmasked area and keep the result seamless.`
        : 'Remove the masked object or region. Fill the area naturally using the surrounding scene. Preserve the unmasked area and keep the result seamless.';
    case 'background':
      return prompt
        ? `Keep the unmasked subject intact. Redesign only the masked background area as: ${prompt}. Match perspective, depth, and lighting naturally.`
        : 'Keep the unmasked subject intact. Redesign only the masked background area. Match perspective, depth, and lighting naturally.';
    case 'restyle':
      return prompt
        ? `Only modify the masked area. Restyle it as: ${prompt}. Preserve the structure of the scene and keep the unmasked area unchanged.`
        : 'Only modify the masked area. Restyle it while preserving the structure of the scene and leaving the unmasked area unchanged.';
    case 'retouch':
    default:
      return prompt
        ? `Refine and repair only the masked area. ${prompt}. Improve anatomy, texture, edges, and local lighting while preserving the unmasked area.`
        : 'Refine and repair only the masked area. Improve anatomy, texture, edges, and local lighting while preserving the unmasked area.';
  }
};
