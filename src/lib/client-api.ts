/** Client-seitiger API-Zugriff: Token im localStorage, Bearer-Authentifizierung */
const KEY = "burgfried_token";

export const tokenStore = {
  get(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
  },
  set(t: string) { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
};

export async function api<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const token = tokenStore.get();
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      keepalive: init.keepalive,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Server nicht erreichbar." } as T & { error?: string } };
  }
}
