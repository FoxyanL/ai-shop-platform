const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; skipRefresh?: boolean };

async function send<T>(path: string, options: RequestOptions = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const currentToken = token ?? sessionStorage.getItem('accessToken') ?? undefined;
  if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (
    response.status === 401 &&
    currentToken &&
    !options.skipRefresh &&
    !path.startsWith('/auth/')
  ) {
    const refresh = await send<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      skipRefresh: true,
    });
    sessionStorage.setItem('accessToken', refresh.accessToken);
    return send<T>(path, options, refresh.accessToken);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Не удалось выполнить запрос (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => send<T>(path),
  post: <T>(path: string, body?: unknown) => send<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: unknown) => send<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => send<T>(path, { method: 'DELETE' }),
  clearToken: () => sessionStorage.removeItem('accessToken'),
};
