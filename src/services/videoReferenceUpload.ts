import { getAuthorizedBillingHeaders } from './accountIdentity';

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取参考视频失败'));
    reader.readAsDataURL(file);
  });

export const uploadVideoReferenceFile = async (file: File): Promise<string> => {
  const video = await readFileAsDataUrl(file);
  const authHeaders = await getAuthorizedBillingHeaders();
  const response = await fetch('/api/video-reference/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      video,
      filename: file.name,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error || '参考视频上传失败'));
  }

  const url = String(data?.url || '').trim();
  if (!url) {
    throw new Error('参考视频上传成功，但未返回可用地址');
  }
  return url;
};
