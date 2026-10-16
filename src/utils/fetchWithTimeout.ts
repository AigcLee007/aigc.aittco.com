import { AppError } from './errorDebug';

// Keep the deadline active through response-body consumption, not just headers.
export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AppError(message, { code: 'CLIENT_REQUEST_TIMEOUT' }));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(consume),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
