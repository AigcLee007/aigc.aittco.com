export const DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS = 60000;

export const revokeDownloadObjectUrlLater = (href: string) => {
  window.setTimeout(() => URL.revokeObjectURL(href), DOWNLOAD_OBJECT_URL_REVOKE_DELAY_MS);
};
