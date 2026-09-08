export async function request<T = Record<string, unknown>>(path: string, body?: unknown, timeoutMs = 45_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Service returned ${response.status}: ${text.slice(0, 180)}`); }
    if (!response.ok) {
      const error = data as { detail?: string; error?: string; message?: string };
      throw new Error(error.detail || error.error || error.message || `Request failed (${response.status})`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('The service timed out. Check the connection and try again.');
    throw error;
  } finally { window.clearTimeout(timeout); }
}

export function socketUrl(path: string) { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`; }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
