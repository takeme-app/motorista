/** Cliente HTTP mínimo para API Spedy (base URL + X-Api-Key). */

export function spedyBaseUrl(): string {
  const u = Deno.env.get('SPEDY_BASE_URL')?.trim();
  if (u) return u.replace(/\/$/, '');
  return 'https://api.spedy.com.br/v1';
}

export function spedyApiKey(): string | null {
  const k = Deno.env.get('SPEDY_API_KEY')?.trim();
  return k || null;
}

export async function spedyJson<T>(
  pathWithQuery: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: T | null; text: string }> {
  const key = spedyApiKey();
  if (!key) {
    return { ok: false, status: 503, json: null, text: 'SPEDY_API_KEY não configurada' };
  }
  const url = `${spedyBaseUrl()}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-Api-Key': key,
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** Extrai lista de itens de respostas paginadas Spedy (`result.items`, `items`, etc.). */
export function unwrapSpedyPagedItems(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  const r = (root.result ?? root.data ?? root) as Record<string, unknown> | unknown[];
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    const items = o.items ?? o.data ?? o.results;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }
  return [];
}
