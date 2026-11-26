type RouteContext = { params: Promise<{ parts: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { parts } = await context.params;
  const incomingUrl = new URL(request.url);
  const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:4000/api/v1';
  const target = `${apiBase}/${parts.map(encodeURIComponent).join('/')}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: 'no-store',
    redirect: 'manual',
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-length');
  responseHeaders.delete('content-encoding');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
