/**
 * MantaGlow hub client for the desktop app.
 * The hub (Next.js, Better Auth) accepts a session token in `x-hub-session-token` for desktop apps (the same path its Tauri
 * apps use), and stores per-app JSON under /api/data/<appSlug>/<key> (PUT body = the value; GET list returns previews with
 * `name` pulled from value.name). Surface's app slug is "surface"; a project is one key: `project:<id>`.
 */
export const HUB_URL = "https://mantaglow.com";
export const APP_SLUG = "surface";

export interface HubUser { id: string; email: string; name: string | null; image: string | null }
export interface HubSession { user: HubUser; session: { activeOrganizationId: string | null }; apps?: { slug: string; name: string; role?: string | null }[]; organization?: { id: string; name: string } | null }
export interface HubListItem { key: string; updated_at: string; created_at?: string; updated_by?: string | null; visibility?: "personal" | "company"; created_by_me?: boolean; preview: { name: string; [k: string]: unknown } }

export class HubClient {
  constructor(private token: string | null, private base = HUB_URL, private fetchImpl: typeof fetch = fetch) {}
  setToken(t: string | null) { this.token = t; }
  get signedIn() { return !!this.token; }
  private async req(path: string, init: RequestInit = {}) {
    if (!this.token) throw new Error("not signed in");
    const r = await this.fetchImpl(`${this.base}${path}`, { ...init, headers: { "Content-Type": "application/json", "x-hub-session-token": this.token, ...(init.headers ?? {}) } });
    if (r.status === 401) throw new Error("session expired — sign in again");
    if (r.status === 403) throw new Error(`no access to app '${APP_SLUG}' in this organization (ask an org admin, or seed the app in the hub)`);
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status}`);
    return r;
  }
  async me(): Promise<HubSession> { return (await this.req("/api/hub/users/me")).json(); }
  async list(): Promise<HubListItem[]> { return (await this.req(`/api/data/${APP_SLUG}`)).json(); }
  async get<T = unknown>(key: string): Promise<{ key: string; value: T; updated_at: string } | null> { const r = await this.fetchImpl(`${this.base}/api/data/${APP_SLUG}/${encodeURIComponent(key)}`, { headers: { "x-hub-session-token": this.token ?? "" } }); if (r.status === 404) return null; if (!r.ok) throw new Error(`GET ${key} → ${r.status}`); return r.json(); }
  async put(key: string, value: unknown): Promise<void> { await this.req(`/api/data/${APP_SLUG}/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(value) }); }
  async delete(key: string): Promise<void> { await this.req(`/api/data/${APP_SLUG}/${encodeURIComponent(key)}`, { method: "DELETE" }); }
}

/** Better Auth's cookie is `<token>.<signature>`; the hub's desktop fallback matches sessions.token, i.e. the part before the dot. */
export function tokenFromCookie(cookieValue: string): string { const v = decodeURIComponent(cookieValue); return v.includes(".") ? v.split(".")[0] : v; }
