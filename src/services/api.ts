const TOKEN_STORAGE_KEY = 'chord_session_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null, rememberMe = true) {
  try {
    if (token) {
      if (rememberMe) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      } else {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage restriction
  }
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const bodyText = await response.text();
  let parsedBody: unknown = null;
  let isJson = false;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText);
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  const data = (
    isJson && parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
      ? parsedBody
      : {}
  ) as Record<string, unknown>;

  if (!response.ok) {
    const serverMessage =
      typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : '';
    const contentType = response.headers.get('content-type') || '';
    const plainText =
      !isJson && bodyText && contentType.includes('text/plain')
        ? bodyText.replace(/\s+/g, ' ').trim().slice(0, 240)
        : '';
    const statusLabel = response.statusText
      ? `${response.status} ${response.statusText}`
      : String(response.status);
    throw new ApiError(serverMessage || plainText || `Request failed (${statusLabel})`, response.status, data);
  }

  return (isJson ? parsedBody : {}) as T;
}

export async function uploadFileToServer(
  file: File | Blob,
  filename: string,
  opts?: { isVoiceMessage?: boolean; durationSec?: number }
) {
  const formData = new FormData();
  formData.append('file', file, filename);
  if (opts?.isVoiceMessage) {
    formData.append('isVoiceMessage', 'true');
  }
  if (opts?.durationSec !== undefined) {
    formData.append('durationSec', String(opts.durationSec));
  }
  return apiRequest<{ attachment: import('../../shared/types.ts').MessageAttachment }>('/api/upload', {
    method: 'POST',
    body: formData,
  });
}
