import { batch, computed, signal } from '@preact/signals';
import { alertFires, alertText, distance, insideFence, shareSeconds, shareUntil, type AlertKind, type LngLat, type ShareFor } from '@nm/core';
import { load, providers, region, requestLocation, simulatingLocation, toast, userLocation } from '@nm/core/app';
import { reverseGeocode, tools } from '@nm/tools';
import { PeopleApi, PeopleError } from './api.ts';

// ---------- shapes the SQL functions return ----------

export interface Me {
  id: string;
  name: string;
  emoji: string | null;
  color: number;
  code: string;
  paused: boolean;
}

export interface PersonLocation {
  lng: number;
  lat: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  battery: number | null;
  charging: boolean | null;
  at: string;
}

export interface MyAlert {
  id: string;
  kind: AlertKind;
  lng: number;
  lat: number;
  radius: number;
  label: string | null;
  repeat: boolean;
}

export interface Person {
  id: string;
  name: string;
  emoji: string | null;
  color: number;
  theyShare: { until: string | null; since: string } | null;
  iShare: { until: string | null; since: string } | null;
  askedMe: boolean;
  iAsked: boolean;
  paused: boolean;
  location: PersonLocation | null;
  alertsAboutMe: { id: string; kind: AlertKind; label: string | null }[];
  myAlerts: MyAlert[];
}

export interface Snapshot {
  me: Me | null;
  people: Person[];
  now: string;
}

export interface InvitePreview {
  name: string;
  emoji: string | null;
  color: number;
  shareSeconds: number | null;
  self: boolean;
}

// ---------- state ----------

/**
 * off: no service configured. start: not signed in yet. profile: signed in, no profile yet.
 * ready: all set. error: the last call failed (`problem` says why).
 */
export type Status = 'off' | 'start' | 'loading' | 'profile' | 'ready' | 'error';
export type Problem = 'anon_disabled' | 'not_installed' | 'offline' | 'other' | null;

export const status = signal<Status>('loading');
export const problem = signal<Problem>(null);
export const snapshot = signal<Snapshot | null>(null);
/** Server clock minus ours, so "updated 2 minutes ago" is right on phones with a wrong clock. */
const skew = signal(0);
export const now = signal(Date.now());
/**
 * Bubbles of friends on the main map. Always on when the app opens (the owner wants to see
 * them every time); the switch hides them only until the next launch.
 */
export const onMap = signal<boolean>(true);
/** Set while a people screen is open: refreshes faster. */
export const watching = signal(0);
/** An invite link the app was opened with, waiting for the user. */
export const pendingInvite = signal<string | null>(null);
/** The last time my position reached the server, and how many people see it. */
export const published = signal<{ at: number; viewers: number } | null>(null);
/** Addresses of friends' positions, by rounded position. */
export const addresses = signal<Record<string, string>>({});

export const me = computed(() => snapshot.value?.me ?? null);
export const people = computed(() => snapshot.value?.people ?? []);
export const serverNow = computed(() => now.value + skew.value);
const active = (s: { until: string | null } | null, at: number) => !!s && (!s.until || Date.parse(s.until) > at);
/** People who see my location now. */
export const viewers = computed(() => people.value.filter((p) => active(p.iShare, serverNow.value)));
/** People whose location I see now. */
export const visible = computed(() => people.value.filter((p) => active(p.theyShare, serverNow.value) && p.location && !p.paused));
/** Requests waiting for my answer. */
export const requests = computed(() => people.value.filter((p) => p.askedMe && !active(p.iShare, serverNow.value)));
export const sharingNow = computed(() => !!me.value && !me.value.paused && viewers.value.length > 0);

export function personById(id: string): Person | undefined {
  return people.peek().find((p) => p.id === id);
}

// ---------- the service ----------

let api: PeopleApi | null = null;

export function service(): PeopleApi | null {
  if (api) return api;
  const { peopleUrl, peopleKey } = providers.peek();
  if (!peopleUrl || !peopleKey) return null;
  api = new PeopleApi(peopleUrl, peopleKey);
  return api;
}

function classify(e: unknown): Problem {
  if (e instanceof PeopleError) {
    if (e.code === 'anon_disabled') return 'anon_disabled';
    // PostgREST: "Could not find the function" (the SQL was not run yet).
    if (e.code === 'PGRST202' || e.code === '42883' || e.status === 404) return 'not_installed';
    return 'other';
  }
  return 'offline';
}

function fail(e: unknown) {
  batch(() => {
    problem.value = classify(e);
    if (!snapshot.peek()) status.value = 'error';
  });
}

// ---------- syncing ----------

let timer: ReturnType<typeof setTimeout> | undefined;
let syncing: Promise<void> | null = null;

export async function sync(): Promise<void> {
  const a = service();
  if (!a) {
    status.value = 'off';
    return;
  }
  if (!a.signedIn) {
    status.value = 'start';
    return;
  }
  syncing ??= (async () => {
    try {
      const s = await a.rpc<Snapshot>('people_snapshot');
      batch(() => {
        skew.value = Date.parse(s.now) - Date.now() || 0;
        now.value = Date.now();
        snapshot.value = s;
        problem.value = null;
        status.value = s.me ? 'ready' : 'profile';
      });
      checkAlerts(s);
      void lookupAddresses(s);
      void maybePublish();
    } catch (e) {
      if (e instanceof PeopleError && e.code === 'refresh_failed' && !a.signedIn) {
        // The account is gone (deleted elsewhere, or the project was reset): start over.
        batch(() => {
          snapshot.value = null;
          status.value = 'start';
        });
      } else fail(e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function schedule() {
  clearTimeout(timer);
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const fast = watching.peek() > 0 || sharingNow.peek();
  timer = setTimeout(async () => {
    if (!(typeof document !== 'undefined' && document.visibilityState === 'hidden')) await sync();
    schedule();
  }, hidden ? 60_000 : fast ? 10_000 : 30_000);
}

/** Starts syncing (at launch) and keeps it going. */
export function startSync() {
  if (!service()) {
    status.value = 'off';
    return;
  }
  void sync().then(schedule);
  setInterval(() => (now.value = Date.now()), 15_000);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync().then(schedule);
    });
  }
  // A screen opening wants fresh data now.
  watching.subscribe((n) => {
    if (n > 0) void sync().then(schedule);
  });
}

async function act<T>(fn: (a: PeopleApi) => Promise<T>, okText?: string): Promise<T | undefined> {
  const a = service();
  if (!a) return undefined;
  try {
    const out = await fn(a);
    if (okText) toast(okText);
    await sync();
    return out;
  } catch (e) {
    const p = classify(e);
    toast(p === 'offline' ? 'אין חיבור כרגע. נסו שוב בעוד רגע.' : errorText(e));
    return undefined;
  }
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : '';
  if (/no such code/.test(m)) return 'לא מצאנו אף אחד עם הקוד הזה. כדאי לבדוק שוב את האותיות.';
  if (/that is you/.test(m)) return 'זה הקוד שלך 🙂';
  if (/invite expired/.test(m)) return 'פג התוקף של ההזמנה. בקשו קישור חדש.';
  if (/too many/.test(m)) return 'הגעתם למקסימום. מחקו משהו ישן ונסו שוב.';
  if (/not shared with you/.test(m)) return 'אפשר להגדיר התראה רק על מי שמשתף איתך מיקום.';
  return 'משהו השתבש. נסו שוב.';
}

// ---------- actions ----------

export async function begin(): Promise<boolean> {
  const a = service();
  if (!a) return false;
  status.value = 'loading';
  try {
    await a.signIn();
    await sync();
    return true;
  } catch (e) {
    batch(() => {
      problem.value = classify(e);
      status.value = 'error';
    });
    return false;
  }
}

export async function saveProfile(name: string, emoji: string | null, color: number): Promise<boolean> {
  const a = service();
  if (!a) return false;
  try {
    if (!a.signedIn) await a.signIn();
    await a.rpc<Me>('people_profile_save', { p_name: name, p_emoji: emoji, p_color: color });
    await sync();
    return true;
  } catch (e) {
    problem.value = classify(e);
    toast(problem.value === 'anon_disabled' || problem.value === 'not_installed' ? 'השירות עוד לא מוכן. נסו שוב מאוחר יותר.' : 'לא הצלחנו לשמור. נסו שוב.');
    return false;
  }
}

const tz = () => region.peek().timeZone;

/** Share my location with someone (also answers their request). */
export function shareWith(p: Person, choice: ShareFor) {
  const until = shareUntil(choice, new Date(serverNow.peek()), tz());
  startLocation();
  return act((a) => a.rpc('people_share', { p_viewer: p.id, p_until: until?.toISOString() ?? null }), `${p.name} רואה עכשיו את המיקום שלך`);
}

export const stopSharing = (p: Person) => act((a) => a.rpc('people_stop_sharing', { p_viewer: p.id }), `הפסקת לשתף עם ${p.name}`);
export const ask = (p: Person) => act((a) => a.rpc('people_ask', { p_other: p.id }), `שלחנו ל${p.name} בקשה. כשיאשרו, תראו אחד את השני`);
export const decline = (p: Person) => act((a) => a.rpc('people_decline', { p_from: p.id }));
export const removePerson = (p: Person) => act((a) => a.rpc('people_remove', { p_other: p.id }), `${p.name} הוסר/ה מהרשימה`);
export const setPaused = (paused: boolean) =>
  act((a) => a.rpc('people_set_paused', { p_paused: paused }), paused ? 'המיקום שלך מוסתר מכולם' : 'המיקום שלך גלוי שוב למי שבחרת');

export async function addByCode(code: string, share: ShareFor | null): Promise<{ name: string } | undefined> {
  const until = share ? shareUntil(share, new Date(serverNow.peek()), tz()) : null;
  if (share) startLocation();
  return act((a) => a.rpc<{ name: string }>('people_add_by_code', { p_code: code, p_share: !!share, p_until: until?.toISOString() ?? null }));
}

/** A link that gives whoever opens it my location for `choice`. */
export async function createInvite(choice: ShareFor): Promise<string | undefined> {
  const a = service();
  if (!a) return undefined;
  try {
    const token = await a.rpc<string>('people_invite_create', { p_share_seconds: shareSeconds(choice, new Date(serverNow.peek()), tz()) });
    startLocation();
    const u = new URL(location.href);
    u.search = `?invite=${token}`;
    u.hash = '';
    return u.toString();
  } catch (e) {
    toast(errorText(e));
    return undefined;
  }
}

export async function peekInvite(token: string): Promise<InvitePreview | null | 'error'> {
  const a = service();
  if (!a) return 'error';
  try {
    if (!a.signedIn) await a.signIn();
    return await a.rpc<InvitePreview | null>('people_invite_peek', { p_token: token });
  } catch (e) {
    problem.value = classify(e);
    return 'error';
  }
}

export async function acceptInvite(token: string, shareBack: ShareFor | null): Promise<{ id: string; name: string } | undefined> {
  const until = shareBack ? shareUntil(shareBack, new Date(serverNow.peek()), tz()) : null;
  if (shareBack) startLocation();
  const out = await act((a) => a.rpc<{ id: string; name: string }>('people_invite_accept', { p_token: token, p_share: !!shareBack, p_until: until?.toISOString() ?? null }));
  if (out) pendingInvite.value = null;
  return out;
}

export async function setAlert(p: Person, kind: AlertKind, at: LngLat, label: string | null, repeat: boolean, radius = 150) {
  void askNotifications();
  return act((a) => a.rpc('people_alert_set', { p_subject: p.id, p_kind: kind, p_lng: at[0], p_lat: at[1], p_radius: radius, p_label: label, p_repeat: repeat }), 'ההתראה נשמרה');
}

export const deleteAlert = (id: string) => act((a) => a.rpc('people_alert_delete', { p_id: id }), 'ההתראה נמחקה');

export async function deleteAccount(): Promise<boolean> {
  const a = service();
  if (!a) return false;
  try {
    await a.rpc('people_delete_me');
    a.forget();
    batch(() => {
      snapshot.value = null;
      published.value = null;
      status.value = 'start';
    });
    toast('החשבון וכל המידע שלו נמחקו');
    return true;
  } catch {
    toast('לא הצלחנו למחוק כרגע. נסו שוב.');
    return false;
  }
}

// ---------- publishing my position ----------

let lastSent: { at: number; lngLat: LngLat } | null = null;
let sending = false;
let battery: { level: number; charging: boolean } | null = null;

/** Ask for GPS (the location feature explains it first, once). */
export function startLocation() {
  if (!userLocation.peek()) requestLocation();
}

async function readBattery() {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }> };
    const b = await nav.getBattery?.();
    if (!b) return;
    const read = () => (battery = { level: b.level, charging: b.charging });
    read();
    b.addEventListener('levelchange', read);
    b.addEventListener('chargingchange', read);
  } catch {
    /* not available (Safari, Firefox) */
  }
}

/** Sends my position when sharing: after moving 25 m, or once a minute, never more than every 8 s. */
export async function maybePublish(force = false) {
  const a = service();
  const loc = userLocation.peek();
  if (!a?.signedIn || !sharingNow.peek() || !loc || simulatingLocation.peek() || sending) return;
  const t = Date.now();
  const here: LngLat = [loc.lng, loc.lat];
  if (!force && lastSent) {
    const moved = distance(lastSent.lngLat, here);
    if (t - lastSent.at < 8_000) return;
    if (moved < 25 && t - lastSent.at < 60_000) return;
  }
  sending = true;
  try {
    const n = await a.rpc<number>('people_publish', {
      p_lng: Math.round(loc.lng * 1e6) / 1e6,
      p_lat: Math.round(loc.lat * 1e6) / 1e6,
      p_accuracy: Math.round(loc.accuracy ?? 0),
      p_heading: loc.heading ?? null,
      p_speed: loc.speed ?? null,
      p_battery: battery ? Math.round(battery.level * 100) / 100 : null,
      p_charging: battery?.charging ?? null,
    });
    lastSent = { at: t, lngLat: here };
    published.value = { at: t, viewers: n };
  } catch {
    /* next fix tries again */
  } finally {
    sending = false;
  }
}

export function startPublishing() {
  void readBattery();
  userLocation.subscribe(() => void maybePublish());
  // Starting to share: send at once, and make sure GPS runs.
  sharingNow.subscribe((on) => {
    if (on) {
      if (load('location:granted', false)) startLocation();
      void maybePublish(true);
    } else lastSent = null;
  });
}

// ---------- arrive / leave alerts (checked on this device) ----------

const fenceState = new Map<string, boolean>();
const seenFix = new Map<string, string>();

function checkAlerts(s: Snapshot) {
  for (const p of s.people) {
    const loc = p.location;
    if (!loc || !p.myAlerts.length || seenFix.get(p.id) === loc.at) continue;
    seenFix.set(p.id, loc.at);
    for (const al of p.myAlerts) {
      const d = distance([loc.lng, loc.lat], [al.lng, al.lat]);
      const prev = fenceState.get(al.id);
      const next = insideFence(prev, d, al.radius, loc.accuracy ?? 0);
      fenceState.set(al.id, next);
      if (alertFires(al.kind, prev, next)) {
        notify(alertText(al.kind, p.name, al.label), p.id);
        if (!al.repeat) void service()?.rpc('people_alert_delete', { p_id: al.id }).catch(() => {});
      }
    }
  }
}

export async function askNotifications() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
  } catch {
    /* fine: alerts still show inside the app */
  }
}

/** Set by the feature: opens a person's card when an alert is tapped. */
export let onAlertTap: (id: string) => void = () => {};
export function setAlertTap(fn: (id: string) => void) {
  onAlertTap = fn;
}

function notify(text: string, personId: string) {
  toast(text, { label: 'הצגה', run: () => onAlertTap(personId) }, 8000);
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const opts = { body: 'נדב מפות · אנשים', tag: `people-${personId}`, icon: new URL('icons/icon-192.png', document.baseURI).href };
    // Android needs the service worker to show it; desktop browsers can do it from the page.
    if (navigator.serviceWorker?.controller) void navigator.serviceWorker.ready.then((r) => r.showNotification(text, opts));
    else new Notification(text, opts);
  } catch {
    /* the toast is enough */
  }
}

// ---------- addresses ----------

const keyOf = (l: { lng: number; lat: number }) => `${l.lng.toFixed(3)},${l.lat.toFixed(3)}`;
export const addressOf = (l: { lng: number; lat: number } | null | undefined) => (l ? addresses.value[keyOf(l)] : undefined);

async function lookupAddresses(s: Snapshot) {
  for (const p of s.people) {
    const l = p.location;
    if (!l) continue;
    const k = keyOf(l);
    if (k in addresses.peek()) continue;
    addresses.value = { ...addresses.peek(), [k]: '' };
    try {
      const place = await tools().call(reverseGeocode, { lng: l.lng, lat: l.lat });
      const text = place ? [place.name, place.address].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : '';
      addresses.value = { ...addresses.peek(), [k]: text };
    } catch {
      /* the card shows the distance instead */
    }
  }
}
