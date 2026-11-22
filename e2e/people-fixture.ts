import type { Page, Route } from '@playwright/test';

/**
 * A fake of our Supabase "people" service (anonymous sign-in + the people_* SQL functions in
 * supabase/migrations/20261116000000_people.sql), in memory, so the e2e tests run offline.
 * It follows the same rules as the SQL: positions are only visible while shared, shares run out.
 */

export const PEOPLE_URL = 'https://people.test';
const ME = 'u-me';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

interface P { id: string; name: string; emoji: string | null; color: number; code: string; paused: boolean }
interface Loc { lng: number; lat: number; accuracy: number; heading: number | null; speed: number | null; battery: number | null; charging: boolean | null; at: string }
interface Alert { id: string; watcher: string; subject: string; kind: string; lng: number; lat: number; radius: number; label: string | null; repeat: boolean }

export interface PeopleWorld {
  profiles: Map<string, P>;
  shares: Map<string, string | null>; // "owner>viewer" -> until
  requests: Set<string>; // "from>to"
  locations: Map<string, Loc>;
  alerts: Alert[];
  invites: Map<string, { owner: string; seconds: number | null }>;
  calls: { fn: string; args: Record<string, unknown> }[];
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** Two friends in Tel Aviv who share with me, and one who asks to see me. */
export function friendsWorld(withMe = true): PeopleWorld {
  const w: PeopleWorld = { profiles: new Map(), shares: new Map(), requests: new Set(), locations: new Map(), alerts: [], invites: new Map(), calls: [] };
  if (withMe) w.profiles.set(ME, { id: ME, name: 'נדב', emoji: '😎', color: 0, code: 'K7M2QX', paused: false });
  w.profiles.set('u-amit', { id: 'u-amit', name: 'עמית', emoji: '🦊', color: 3, code: 'AMT234', paused: false });
  w.profiles.set('u-noa', { id: 'u-noa', name: 'נועה לוי', emoji: null, color: 4, code: 'NOA567', paused: false });
  w.profiles.set('u-yoni', { id: 'u-yoni', name: 'יוני', emoji: '🚴', color: 2, code: 'YON789', paused: false });
  w.profiles.set('u-dana', { id: 'u-dana', name: 'דנה', emoji: '🌻', color: 5, code: 'DAN234', paused: false });
  if (withMe) {
    w.shares.set('u-amit>u-me', null);
    w.shares.set('u-noa>u-me', new Date(Date.now() + 40 * 60_000).toISOString());
    w.shares.set('u-me>u-amit', null);
    w.requests.add('u-yoni>u-me');
  }
  w.locations.set('u-amit', { lng: 34.7818, lat: 32.0853, accuracy: 12, heading: 90, speed: 1.3, battery: 0.82, charging: false, at: iso(20_000) });
  w.locations.set('u-noa', { lng: 34.7703, lat: 32.0735, accuracy: 40, heading: null, speed: 0, battery: 0.12, charging: false, at: iso(25 * 60_000) });
  w.locations.set('u-dana', { lng: 34.79, lat: 32.08, accuracy: 10, heading: null, speed: 0, battery: 0.5, charging: true, at: iso(10_000) });
  w.invites.set('INVITEDANA01', { owner: 'u-dana', seconds: 3600 });
  return w;
}

const active = (w: PeopleWorld, owner: string, viewer: string) => {
  if (!w.shares.has(`${owner}>${viewer}`)) return false;
  const u = w.shares.get(`${owner}>${viewer}`);
  return !u || Date.parse(u) > Date.now();
};

function snapshot(w: PeopleWorld) {
  const me = w.profiles.get(ME) ?? null;
  if (!me) return { me: null, people: [], now: new Date().toISOString() };
  const ids = new Set<string>();
  for (const k of w.shares.keys()) {
    const [o, v] = k.split('>');
    if (o === ME) ids.add(v);
    if (v === ME) ids.add(o);
  }
  for (const k of w.requests) {
    const [f, t] = k.split('>');
    if (f === ME) ids.add(t);
    if (t === ME) ids.add(f);
  }
  const share = (o: string, v: string) => (w.shares.has(`${o}>${v}`) ? { until: w.shares.get(`${o}>${v}`) ?? null, since: iso(3600_000) } : null);
  const people = [...ids].map((id) => {
    const p = w.profiles.get(id)!;
    const sees = active(w, id, ME);
    return {
      id, name: p.name, emoji: p.emoji, color: p.color,
      theyShare: share(id, ME), iShare: share(ME, id),
      askedMe: w.requests.has(`${id}>${ME}`), iAsked: w.requests.has(`${ME}>${id}`),
      paused: p.paused && sees,
      location: sees && !p.paused ? w.locations.get(id) ?? null : null,
      alertsAboutMe: w.alerts.filter((a) => a.watcher === id && a.subject === ME).map((a) => ({ id: a.id, kind: a.kind, label: a.label })),
      myAlerts: w.alerts.filter((a) => a.watcher === ME && a.subject === id),
    };
  });
  return { me, people, now: new Date().toISOString() };
}

function rpc(w: PeopleWorld, fn: string, a: Record<string, any>): unknown {
  switch (fn) {
    case 'people_snapshot':
      return snapshot(w);
    case 'people_profile_save': {
      const old = w.profiles.get(ME);
      const p = { id: ME, name: a.p_name, emoji: a.p_emoji, color: a.p_color, code: old?.code ?? 'K7M2QX', paused: old?.paused ?? false };
      w.profiles.set(ME, p);
      return p;
    }
    case 'people_publish': {
      const n = [...w.shares.keys()].filter((k) => k.startsWith(`${ME}>`) && active(w, ME, k.split('>')[1])).length;
      if (n) w.locations.set(ME, { lng: a.p_lng, lat: a.p_lat, accuracy: a.p_accuracy, heading: a.p_heading, speed: a.p_speed, battery: a.p_battery, charging: a.p_charging, at: new Date().toISOString() });
      return n;
    }
    case 'people_share': {
      // Like the SQL: answering their request makes it mutual, for the same time.
      const asked = w.requests.delete(`${a.p_viewer}>${ME}`);
      w.shares.set(`${ME}>${a.p_viewer}`, a.p_until);
      if (asked) {
        const theirs = w.shares.get(`${a.p_viewer}>${ME}`);
        const keep = theirs === null || a.p_until === null ? null : theirs && theirs > a.p_until ? theirs : a.p_until;
        w.shares.set(`${a.p_viewer}>${ME}`, keep);
        w.requests.delete(`${ME}>${a.p_viewer}`);
      }
      return null;
    }
    case 'people_stop_sharing':
      w.shares.delete(`${ME}>${a.p_viewer}`);
      return null;
    case 'people_ask':
      w.requests.add(`${ME}>${a.p_other}`);
      return null;
    case 'people_decline':
      w.requests.delete(`${a.p_from}>${ME}`);
      return null;
    case 'people_remove':
      for (const k of [...w.shares.keys()]) if (k === `${ME}>${a.p_other}` || k === `${a.p_other}>${ME}`) w.shares.delete(k);
      w.requests.delete(`${ME}>${a.p_other}`);
      w.requests.delete(`${a.p_other}>${ME}`);
      return null;
    case 'people_set_paused':
      w.profiles.get(ME)!.paused = a.p_paused;
      return null;
    case 'people_add_by_code': {
      const other = [...w.profiles.values()].find((p) => p.code === a.p_code);
      if (!other) throw Object.assign(new Error('no such code'), { code: 'P0002' });
      w.requests.add(`${ME}>${other.id}`);
      if (a.p_share) w.shares.set(`${ME}>${other.id}`, a.p_until);
      return { id: other.id, name: other.name, emoji: other.emoji, color: other.color };
    }
    case 'people_invite_create':
      w.invites.set('MYINVITE0001', { owner: ME, seconds: a.p_share_seconds });
      return 'MYINVITE0001';
    case 'people_invite_peek': {
      const i = w.invites.get(a.p_token);
      if (!i) return null;
      const p = w.profiles.get(i.owner)!;
      return { name: p.name, emoji: p.emoji, color: p.color, shareSeconds: i.seconds, self: i.owner === ME };
    }
    case 'people_invite_accept': {
      const i = w.invites.get(a.p_token)!;
      w.shares.set(`${i.owner}>${ME}`, i.seconds ? new Date(Date.now() + i.seconds * 1000).toISOString() : null);
      if (a.p_share) w.shares.set(`${ME}>${i.owner}`, a.p_until);
      else w.requests.add(`${i.owner}>${ME}`);
      const p = w.profiles.get(i.owner)!;
      return { id: p.id, name: p.name, emoji: p.emoji, color: p.color };
    }
    case 'people_alert_set': {
      const id = `al-${w.alerts.length + 1}`;
      w.alerts.push({ id, watcher: ME, subject: a.p_subject, kind: a.p_kind, lng: a.p_lng, lat: a.p_lat, radius: a.p_radius, label: a.p_label, repeat: a.p_repeat });
      return id;
    }
    case 'people_alert_delete':
      w.alerts = w.alerts.filter((x) => x.id !== a.p_id);
      return null;
    case 'people_delete_me':
      w.profiles.delete(ME);
      return null;
  }
  throw Object.assign(new Error(`Could not find the function public.${fn}`), { code: 'PGRST202' });
}

/** Serves the fake service at PEOPLE_URL. Open the app with `?people=https://people.test`. */
export async function stubPeople(page: Page, w: PeopleWorld, opts: { anonDisabled?: boolean } = {}) {
  await page.route(`${PEOPLE_URL}/**`, async (r: Route) => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    if (url.pathname === '/auth/v1/signup') {
      if (opts.anonDisabled) return r.fulfill({ status: 422, json: { code: 422, error_code: 'anonymous_provider_disabled', msg: 'Anonymous sign-ins are disabled' }, headers: cors });
      return r.fulfill({ json: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: ME } }, headers: cors });
    }
    if (url.pathname === '/auth/v1/token') return r.fulfill({ json: { access_token: 'tok2', refresh_token: 'ref2', expires_in: 3600, user: { id: ME } }, headers: cors });
    const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (!m) return r.fulfill({ status: 404, body: '', headers: cors });
    const args = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    w.calls.push({ fn: m[1], args });
    try {
      return r.fulfill({ json: rpc(w, m[1], args), headers: cors });
    } catch (e) {
      const err = e as Error & { code?: string };
      return r.fulfill({ status: err.code === 'PGRST202' ? 404 : 400, json: { message: err.message, code: err.code }, headers: cors });
    }
  });
}

/** Starts the page already signed in (as if the user had joined before). */
export async function signedIn(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('nm:people:session', JSON.stringify({ access: 'tok', refresh: 'ref', expires: Date.now() + 3600_000, userId: 'u-me' }));
  });
}
