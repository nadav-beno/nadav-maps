import { load, remove, save } from '@nm/core/app';

/**
 * A tiny client for our Supabase project: anonymous sign-in (no phone, no email, no password),
 * token refresh, and calls to the people_* SQL functions. Plain fetch, no SDK: the feature only
 * needs these three things and the e2e tests stub them with page.route.
 */

export interface Session {
  access: string;
  refresh: string;
  /** Unix ms when `access` expires. */
  expires: number;
  userId: string;
}

const KEY = 'people:session';

export class PeopleError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class PeopleApi {
  readonly url: string;
  readonly key: string;
  private session: Session | null;
  private refreshing: Promise<Session> | null = null;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
    this.session = load<Session | null>(KEY, null);
  }

  get signedIn(): boolean {
    return !!this.session;
  }

  get userId(): string | null {
    return this.session?.userId ?? null;
  }

  private headers(token?: string): Record<string, string> {
    // Publishable keys (sb_publishable_…) are not JWTs: they go only in `apikey`.
    return token ? { apikey: this.key, 'content-type': 'application/json', authorization: `Bearer ${token}` } : { apikey: this.key, 'content-type': 'application/json' };
  }

  private keep(j: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number; user?: { id: string } }): Session {
    const expires = j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000;
    const s: Session = { access: j.access_token, refresh: j.refresh_token, expires, userId: j.user?.id ?? this.session?.userId ?? '' };
    this.session = s;
    save(KEY, s);
    return s;
  }

  /** Creates an anonymous account (Supabase "Allow anonymous sign-ins" must be on). */
  async signIn(): Promise<void> {
    if (this.session) return;
    const r = await fetch(`${this.url}/auth/v1/signup`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ data: {} }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      const msg = String(j.msg ?? j.message ?? j.error_description ?? r.statusText);
      throw new PeopleError(msg, /anonymous/i.test(msg) ? 'anon_disabled' : String(j.error_code ?? r.status), r.status);
    }
    this.keep(j);
  }

  private async token(): Promise<string> {
    const s = this.session;
    if (!s) throw new PeopleError('not signed in', 'no_session', 401);
    if (s.expires - Date.now() > 60_000) return s.access;
    this.refreshing ??= (async () => {
      try {
        const r = await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: this.headers(), body: JSON.stringify({ refresh_token: s.refresh }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) {
          // A refresh token that the server no longer knows means the account is gone.
          if (r.status === 400 || r.status === 401 || r.status === 403) this.forget();
          throw new PeopleError(String(j.msg ?? j.error_description ?? r.statusText), 'refresh_failed', r.status);
        }
        return this.keep(j);
      } finally {
        this.refreshing = null;
      }
    })();
    return (await this.refreshing).access;
  }

  /** Calls public.<fn>(args) and returns its JSON result. */
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const token = await this.token();
    const r = await fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: this.headers(token), body: JSON.stringify(args) });
    const text = await r.text();
    let j: unknown = null;
    try {
      j = text ? JSON.parse(text) : null;
    } catch {
      j = text;
    }
    if (!r.ok) {
      const e = (j ?? {}) as { message?: string; code?: string };
      if (r.status === 401) this.session = { ...this.session!, expires: 0 };
      throw new PeopleError(e.message ?? r.statusText, e.code ?? String(r.status), r.status);
    }
    return j as T;
  }

  /** Signs out on this device only (the account stays on the server). */
  forget(): void {
    this.session = null;
    remove(KEY);
  }
}
