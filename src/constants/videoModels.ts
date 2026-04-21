export const VIDEO_LOSS_CONFIG = {
  'veo3.1-fast': { max: 2, labels: ['\u9996\u5E27', '\u5C3E\u5E27'] },
  'veo3.1-fast-4K': { max: 2, labels: ['\u9996\u5E27', '\u5C3E\u5E27'] },
  'veo3.1-pro': { max: 2, labels: ['\u9996\u5E27', '\u5C3E\u5E27'] },
  'veo3.1-pro-4k': { max: 2, labels: ['\u9996\u5E27', '\u5C3E\u5E27'] },
  'veo3.1-components': { max: 3, labels: [] },
  'veo3.1-fast-components-4K': { max: 3, labels: [] },
  'grok-video-3': { max: 1, labels: [] },

  // Legacy aliases for backward compatibility
  'veo3.1-4k': { max: 2, labels: ['\u9996\u5E27', '\u5C3E\u5E27'] },
  'veo3.1-components-4k': { max: 3, labels: [] },
} as const;

export const VIDEO_COSTS: Record<string, number> = {
  'veo3.1-fast': 5,
  'veo3.1-components': 7.5,
  'grok-video-3': 12.5,
  'veo3.1-pro': 25,
  'veo3.1-fast-4K': 50,
  'veo3.1-fast-components-4K': 50,
  'veo3.1-pro-4k': 50,

  // Legacy aliases for backward compatibility
  'veo3.1-4k': 50,
  'veo3.1-components-4k': 50,
};
