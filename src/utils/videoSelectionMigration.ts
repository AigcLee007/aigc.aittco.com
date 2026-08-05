export interface VideoReferenceItem {
  id?: string;
  url: string;
  name?: string;
}

export const migrateVideoSelectionState = (state: Record<string, unknown>) => {
  const legacyUrl = String(state.videoReferenceUrl || '').trim();
  const existingVideos = Array.isArray(state.videoReferenceVideos)
    ? state.videoReferenceVideos
    : legacyUrl
      ? [{ url: legacyUrl }]
      : [];
  return {
    ...state,
    videoModel: String(state.videoModel || 'gemini-omni-flash'),
    videoResolution: String(state.videoResolution || (state.videoHd === true ? '1080p' : '720p')),
    videoReferenceVideos: existingVideos,
  };
};
