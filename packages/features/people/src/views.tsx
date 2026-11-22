import { useEffect, useRef, useState } from 'preact/hooks';
import {
  agoText, alertSummary, batteryIcon, distance, formatDistance, freshness, initialsOf, movingText, normalizeCode, PERSON_COLORS,
  PERSON_EMOJIS, personColor, pointPlaceId, prettyCode, SHARE_CHOICES, shareLeft, type AlertKind, type ShareFor,
} from '@nm/core';
import { back, directionsTo, Icon, open, region, toast, units, userLocation, viewStack, type ViewProps } from '@nm/core/app';
import {
  acceptInvite, addByCode, addressOf, ask, begin, createInvite, decline, deleteAccount, deleteAlert, me, onMap, peekInvite, pendingInvite,
  people, personById, problem, published, removePerson, requests, saveProfile, serverNow, setAlert, setPaused, shareWith, startLocation,
  status, stopSharing, sync, viewers, visible, watching, type InvitePreview, type Person,
} from './store.ts';
import { fitAll, flyToPerson, selectedPerson } from './map.ts';

export const PEOPLE_VIEW = 'people';
export const PERSON_VIEW = 'person';
export const ADD_VIEW = 'people-add';
export const INVITE_VIEW = 'people-invite';
export const ME_VIEW = 'people-me';

export function openPeople(replace = false) {
  open({ kind: PEOPLE_VIEW, props: { url: { panel: 'people' } } }, { replace });
}

export function openPerson(id: string, replace = false) {
  const top = viewStack.peek()[viewStack.peek().length - 1];
  open({ kind: PERSON_VIEW, props: { id, url: { panel: 'people' } } }, { replace: replace || top?.kind === PERSON_VIEW });
}

/**
 * Keeps refreshing fast while a people screen is on screen, and starts each screen at its top
 * (the panel keeps its scroll between screens). Returns a ref for the screen's root element.
 */
function useWatching(key?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    watching.value++;
    return () => void watching.value--;
  }, []);
  useEffect(() => {
    for (let el = ref.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        el.scrollTop = 0;
        break;
      }
    }
  }, [key]);
  return ref;
}

const tz = () => region.value.timeZone;
const here = () => {
  const u = userLocation.value;
  return u ? ([u.lng, u.lat] as [number, number]) : null;
};

// ---------- small pieces ----------

export function Avatar({ name, emoji, color, size = 44, fresh, ring }: { name: string; emoji?: string | null; color: number; size?: number; fresh?: string; ring?: boolean }) {
  return (
    <span
      class={`pp-avatar${emoji ? ' pp-emoji' : ''}${ring ? ' pp-ring' : ''}${fresh ? ` pp-${fresh}` : ''}`}
      style={{ '--pp-color': personColor(color), '--pp-size': `${size}px` }}
      aria-hidden="true"
    >
      <span class="pp-face">{emoji || initialsOf(name)}</span>
      {fresh === 'live' && <span class="pp-live" />}
    </span>
  );
}

function Header({ title, onBack = back, icon = 'arrow_back' }: { title: string; onBack?: () => void; icon?: string }) {
  return (
    <div class="view-header">
      <button class="icon-btn" aria-label={icon === 'close' ? 'סגירה' : 'חזרה'} title={icon === 'close' ? 'סגירה' : 'חזרה'} onClick={onBack}>
        <Icon name={icon} />
      </button>
      <h2>{title}</h2>
    </div>
  );
}

function Switch({ title, sub, checked, onChange }: { title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="tl-switch-row">
      <span class="li-body">
        <span class="li-title">{title}</span>
        {sub && <span class="li-sub">{sub}</span>}
      </span>
      <input type="checkbox" role="switch" class="tl-switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
    </label>
  );
}

function DurationPicker({ value, onChange, label }: { value: ShareFor; onChange: (v: ShareFor) => void; label: string }) {
  return (
    <div class="segmented pp-duration" role="group" aria-label={label}>
      {SHARE_CHOICES.map((c) => (
        <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

function distanceTo(p: Person): string {
  const h = here();
  if (!h || !p.location) return '';
  const d = distance(h, [p.location.lng, p.location.lat]);
  return d < 60 ? 'לידך' : formatDistance(d, units.value);
}

/** The line under a person's name in the list. */
function personLine(p: Person, t: number): string {
  if (p.theyShare && p.paused) return 'המיקום מוסתר זמנית';
  if (p.theyShare && p.location) return addressOf(p.location) || movingText(p.location.speed) || 'המיקום משותף איתך';
  if (p.theyShare) return 'מחכים למיקום הראשון';
  if (p.askedMe) return 'מבקש/ת לראות את המיקום שלך';
  if (p.iAsked) return 'ביקשת לראות את המיקום · ממתין לאישור';
  if (p.iShare) return `רואה את המיקום שלך · ${shareLeft(p.iShare.until, t, tz())}`;
  return 'אין שיתוף כרגע';
}

// ---------- the people list ----------

function Problem() {
  const p = problem.value;
  const text =
    p === 'anon_disabled'
      ? 'השירות עוד לא הופעל: צריך להדליק ב-Supabase את "Allow anonymous sign-ins".'
      : p === 'not_installed'
        ? 'השירות עוד לא הותקן: צריך להריץ את people-tables.sql ב-Supabase.'
        : p === 'offline'
          ? 'אין חיבור לאינטרנט כרגע.'
          : 'משהו השתבש בחיבור לשירות.';
  return (
    <div class="pp-empty" role="status">
      <Icon name="warning" size={32} />
      <p>{text}</p>
      <button class="btn tonal" onClick={() => void (status.peek() === 'error' && !me.peek() ? begin() : sync())}>
        <Icon name="refresh" /> ניסיון נוסף
      </button>
    </div>
  );
}

function Hero() {
  // Three friends around a pin, drawn with our own avatars (no images).
  return (
    <div class="pp-hero" aria-hidden="true">
      <span class="pp-hero-ring" />
      <span class="pp-hero-ring pp-hero-ring2" />
      <span class="pp-hero-a1"><Avatar name="א" emoji="🦊" color={3} size={52} ring /></span>
      <span class="pp-hero-a2"><Avatar name="ב" emoji="🐼" color={4} size={44} ring /></span>
      <span class="pp-hero-a3"><Avatar name="ג" emoji="🚴" color={2} size={48} ring /></span>
      <span class="pp-hero-me" />
    </div>
  );
}

export function ProfileForm({ cta, onDone }: { cta: string; onDone?: () => void }) {
  const m = me.value;
  const [name, setName] = useState(m?.name ?? '');
  const [emoji, setEmoji] = useState<string | null>(m ? m.emoji : PERSON_EMOJIS[0]);
  const [color, setColor] = useState(m?.color ?? 0);
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0;
  return (
    <form
      class="pp-profile"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        const done = await saveProfile(name.trim(), emoji, color);
        setBusy(false);
        if (done) onDone?.();
      }}
    >
      <div class="pp-profile-preview">
        <Avatar name={name || '?'} emoji={emoji} color={color} size={72} ring />
      </div>
      <div class="field">
        <label for="pp-name">איך יראו אותך החברים</label>
        <input id="pp-name" class="input" maxLength={40} placeholder="השם שלך" autoComplete="nickname" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </div>
      <div class="pp-pick" role="group" aria-label="אימוג'י">
        <button type="button" class="pp-pick-btn pp-pick-letter" aria-pressed={!emoji} aria-label="האות הראשונה" onClick={() => setEmoji(null)}>
          {initialsOf(name || 'א')}
        </button>
        {PERSON_EMOJIS.map((em) => (
          <button key={em} type="button" class="pp-pick-btn" aria-pressed={emoji === em} aria-label={em} onClick={() => setEmoji(em)}>
            {em}
          </button>
        ))}
      </div>
      <div class="pp-colors" role="group" aria-label="צבע">
        {PERSON_COLORS.map((c, i) => (
          <button key={c} type="button" class="pp-color" style={{ background: c }} aria-pressed={color === i} aria-label={`צבע ${i + 1}`} onClick={() => setColor(i)} />
        ))}
      </div>
      <button class="btn primary big full" disabled={!ok || busy}>
        {busy ? 'רגע…' : cta}
      </button>
    </form>
  );
}

function Onboarding() {
  return (
    <div class="pp-onboard">
      <Hero />
      <h3 class="pp-title">החברים שלך, על המפה</h3>
      <p class="pp-lead">משתפים מיקום עם מי שבוחרים, לשעה, עד סוף היום או בלי הגבלה. רואים מי קרוב, מנווטים אליו בלחיצה, ומקבלים התראה כשמישהו מגיע.</p>
      <ul class="pp-promises">
        <li><Icon name="lock" /> בלי טלפון, בלי אימייל ובלי סיסמה</li>
        <li><Icon name="visibility" /> רק מי שבחרת רואה אותך, ורק כל עוד בחרת</li>
        <li><Icon name="history" /> נשמר רק המיקום האחרון, בלי היסטוריה</li>
      </ul>
      <ProfileForm cta="יאללה, מתחילים" />
    </div>
  );
}

function MeCard() {
  const m = me.value!;
  const n = viewers.value.length;
  const pub = published.value;
  const t = serverNow.value;
  const line = m.paused
    ? 'המיקום שלך מוסתר מכולם'
    : n === 0
      ? 'המיקום שלך לא משותף עם אף אחד'
      : `${n === 1 ? `${viewers.value[0].name} רואה` : `${n} אנשים רואים`} את המיקום שלך${pub ? ` · נשלח ${agoText(pub.at + (t - Date.now()), t)}` : ''}`;
  return (
    <button class="pp-me" onClick={() => open({ kind: ME_VIEW, props: { url: { panel: 'people' } } })}>
      <Avatar name={m.name} emoji={m.emoji} color={m.color} size={48} ring />
      <span class="pp-me-body">
        <span class="pp-me-name">{m.name} <span class="muted small">(אני)</span></span>
        <span class={`pp-me-line${m.paused ? ' pp-warn' : n ? ' pp-on' : ''}`}>
          {!m.paused && n > 0 && <span class="pp-pulse" aria-hidden="true" />}
          {line}
        </span>
      </span>
      <Icon name="chevron_left" />
    </button>
  );
}

function RequestCard({ p }: { p: Person }) {
  const [choice, setChoice] = useState<ShareFor>('1h');
  return (
    <div class="pp-request" role="group" aria-label={`בקשה מ${p.name}`}>
      <div class="pp-request-head">
        <Avatar name={p.name} emoji={p.emoji} color={p.color} size={40} />
        <div>
          <div class="pp-request-name">{p.name}</div>
          <div class="small muted">מבקש/ת לראות את המיקום שלך</div>
        </div>
      </div>
      <p class="small muted pp-mutual"><Icon name="sync_alt" size={16} /> השיתוף הדדי: אם תאשרו, גם את {p.name.split(' ')[0]} תראו על המפה, לאותו זמן.</p>
      <DurationPicker value={choice} onChange={setChoice} label="לכמה זמן לשתף" />
      <div class="pp-request-actions">
        <button class="btn primary" onClick={() => void shareWith(p, choice)}>
          <Icon name="share_location" /> שיתוף
        </button>
        <button class="btn" onClick={() => void decline(p)}>לא עכשיו</button>
      </div>
    </div>
  );
}

function PersonRow({ p }: { p: Person }) {
  const t = serverNow.value;
  const fresh = p.location && p.theyShare && !p.paused ? freshness(p.location.at, t) : undefined;
  const dist = p.theyShare && !p.paused ? distanceTo(p) : '';
  return (
    <li>
      <button class="pp-row" onClick={() => (openPerson(p.id), p.location && p.theyShare && !p.paused && setTimeout(() => flyToPerson(p), 80))}>
        <Avatar name={p.name} emoji={p.emoji} color={p.color} fresh={fresh ?? (p.theyShare ? undefined : 'none')} />
        <span class="pp-row-body">
          <span class="pp-row-name">{p.name}</span>
          <span class="pp-row-sub">{personLine(p, t)}</span>
        </span>
        <span class="pp-row-end">
          {dist && <span class="pp-row-dist">{dist}</span>}
          {p.location && p.theyShare && !p.paused && <span class="small muted">{agoText(p.location.at, t)}</span>}
        </span>
      </button>
    </li>
  );
}

function sortPeople(list: Person[]): Person[] {
  const h = here();
  const rank = (p: Person) => (p.theyShare && p.location && !p.paused ? 0 : p.theyShare ? 1 : p.iShare ? 2 : 3);
  const d = (p: Person) => (h && p.location ? distance(h, [p.location.lng, p.location.lat]) : Infinity);
  return [...list].sort((a, b) => rank(a) - rank(b) || d(a) - d(b) || a.name.localeCompare(b.name, 'he'));
}

export function PeopleView(_: ViewProps) {
  const st = status.value;
  const root = useWatching(st);
  // Like opening the app: everyone I can see (and me) fits on the map, once per opening.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || st !== 'ready' || !visible.peek().length) return;
    fitted.current = true;
    setTimeout(() => fitAll(here()), 120);
  }, [st, visible.value.length]);
  const close = (
    <button class="icon-btn" aria-label="סגירה" title="סגירה" onClick={back}>
      <Icon name="close" />
    </button>
  );
  const head = (
    <div class="view-header pp-header">
      <h2>אנשים</h2>
      {st === 'ready' && visible.value.length > 0 && (
        <button class="icon-btn" aria-label="כולם במפה" title="כולם במפה" onClick={() => fitAll(here())}>
          <Icon name="groups" />
        </button>
      )}
      {close}
    </div>
  );
  if (st === 'off') {
    return (
      <div class="view pp" ref={root}>
        {head}
        <div class="pp-empty">
          <Icon name="group" size={36} />
          <p>שיתוף מיקום עם חברים עוד לא מופעל באתר הזה.</p>
        </div>
      </div>
    );
  }
  if (st === 'loading') {
    return (
      <div class="view pp" ref={root}>
        {head}
        <div class="pp-skeleton" aria-label="טוען">
          <span /><span /><span />
        </div>
      </div>
    );
  }
  if (st === 'error') return <div class="view pp" ref={root}>{head}<Problem /></div>;
  if (st === 'start' || st === 'profile' || !me.value) return <div class="view pp" ref={root}>{head}<Onboarding /></div>;
  const reqs = requests.value;
  const list = sortPeople(people.value.filter((p) => !reqs.includes(p)));
  return (
    <div class="view pp" ref={root}>
      {head}
      <MeCard />
      {problem.value === 'offline' && <p class="pp-offline small" role="status"><Icon name="warning" size={16} /> אין חיבור. מציגים את המצב האחרון.</p>}
      {reqs.length > 0 && (
        <section aria-label="בקשות">
          <h3 class="pp-section">בקשות</h3>
          {reqs.map((p) => <RequestCard key={p.id} p={p} />)}
        </section>
      )}
      {list.length > 0 ? (
        <section aria-label="האנשים שלי">
          <h3 class="pp-section">האנשים שלי</h3>
          <ul class="pp-list">{list.map((p) => <PersonRow key={p.id} p={p} />)}</ul>
        </section>
      ) : (
        !reqs.length && (
          <div class="pp-empty pp-empty-list">
            <Hero />
            <p><b>עוד אין כאן אף אחד.</b><br />שלחו קישור לחבר או לבת משפחה, וברגע שיפתחו אותו תראו אחד את השני על המפה.</p>
          </div>
        )
      )}
      <button class="btn primary big full pp-add" onClick={() => open({ kind: ADD_VIEW, props: { url: { panel: 'people' } } })}>
        <Icon name="person_add" /> הוספת אדם
      </button>
      <Switch title="הצגת האנשים במפה" sub="גם כשהמסך הזה סגור. חוזר בכל פתיחה של האפליקציה" checked={onMap.value} onChange={(v) => (onMap.value = v)} />
    </div>
  );
}

// ---------- one person ----------

function ShareMine({ p }: { p: Person }) {
  const t = serverNow.value;
  const [choice, setChoice] = useState<ShareFor>('1h');
  const [changing, setChanging] = useState(false);
  const live = p.iShare && (!p.iShare.until || Date.parse(p.iShare.until) > t);
  if (live && !changing) {
    return (
      <div class="pp-card">
        <div class="pp-card-row">
          <Icon name="share_location" class="pp-on-icon" />
          <div class="pp-card-body">
            <div class="pp-card-title">{p.name} רואה את המיקום שלך</div>
            <div class="small muted">{shareLeft(p.iShare!.until, t, tz())}{me.value?.paused ? ' · כרגע מוסתר מכולם' : ''}</div>
          </div>
        </div>
        <div class="pp-card-actions">
          <button class="btn small" onClick={() => setChanging(true)}>שינוי הזמן</button>
          <button class="btn small danger" onClick={() => void stopSharing(p)}>הפסקת השיתוף</button>
        </div>
      </div>
    );
  }
  return (
    <div class="pp-card">
      <div class="pp-card-title">{changing ? 'לכמה זמן לשתף?' : `שיתוף המיקום שלך עם ${p.name}`}</div>
      <DurationPicker value={choice} onChange={setChoice} label="לכמה זמן לשתף" />
      <div class="pp-card-actions">
        <button
          class="btn primary"
          onClick={async () => {
            await shareWith(p, choice);
            setChanging(false);
          }}
        >
          <Icon name="share_location" /> {changing ? 'עדכון' : 'שיתוף'}
        </button>
        {changing && <button class="btn" onClick={() => setChanging(false)}>ביטול</button>}
      </div>
    </div>
  );
}

function Alerts({ p }: { p: Person }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AlertKind>('arrive');
  const [where, setWhere] = useState<'me' | 'them'>('me');
  const [repeat, setRepeat] = useState(false);
  const h = here();
  const sees = !!p.theyShare && !!p.location;
  if (!p.theyShare) return null;
  const add = () => {
    const at = where === 'me' ? h : p.location ? ([p.location.lng, p.location.lat] as [number, number]) : null;
    if (!at) {
      if (where === 'me') startLocation();
      toast(where === 'me' ? 'מחכים למיקום שלך…' : `עוד אין מיקום של ${p.name}`);
      return;
    }
    const label = where === 'me' ? 'המיקום שלך' : addressOf(p.location) || 'המקום הנוכחי';
    void setAlert(p, kind, at, label, repeat).then(() => setAdding(false));
  };
  return (
    <section aria-label="התראות">
      <h3 class="pp-section">התראות</h3>
      {p.myAlerts.map((a) => (
        <div key={a.id} class="pp-alert">
          <Icon name="notifications_active" />
          <span class="pp-alert-text">{alertSummary(a.kind, a.label)}{a.repeat ? ' · בכל פעם' : ' · פעם אחת'}</span>
          <button class="icon-btn" aria-label="מחיקת ההתראה" title="מחיקה" onClick={() => void deleteAlert(a.id)}>
            <Icon name="delete" />
          </button>
        </div>
      ))}
      {adding ? (
        <div class="pp-card">
          <div class="segmented" role="group" aria-label="מתי">
            <button type="button" aria-pressed={kind === 'arrive'} onClick={() => setKind('arrive')}>בהגעה</button>
            <button type="button" aria-pressed={kind === 'leave'} onClick={() => setKind('leave')}>ביציאה</button>
          </div>
          <div class="segmented" role="group" aria-label="איפה">
            <button type="button" aria-pressed={where === 'me'} onClick={() => setWhere('me')}>למיקום שלי</button>
            <button type="button" aria-pressed={where === 'them'} disabled={!sees} onClick={() => setWhere('them')}>מאיפה ש{p.name.split(' ')[0]} עכשיו</button>
          </div>
          <Switch title="בכל פעם" sub="אחרת ההתראה נמחקת אחרי שהיא מופיעה" checked={repeat} onChange={setRepeat} />
          <p class="small muted">{p.name} יראה/תראה שהגדרת התראה. ההתראה מופיעה כשהאפליקציה פתוחה אצלך.</p>
          <div class="pp-card-actions">
            <button class="btn primary" onClick={add}><Icon name="notifications" /> שמירה</button>
            <button class="btn" onClick={() => setAdding(false)}>ביטול</button>
          </div>
        </div>
      ) : (
        <button class="pp-link-row" onClick={() => setAdding(true)}>
          <Icon name="add" /> הוספת התראה
        </button>
      )}
    </section>
  );
}

export function PersonView({ view }: ViewProps<{ id: string }>) {
  
  const id = view.props?.id ?? '';
  const root = useWatching(id);
  useEffect(() => {
    selectedPerson.value = id;
    return () => {
      if (selectedPerson.peek() === id) selectedPerson.value = null;
    };
  }, [id]);
  const p = people.value.find((x) => x.id === id);
  const t = serverNow.value;
  if (!p) {
    return (
      <div class="view pp" ref={root}>
        <Header title="אנשים" />
        <p class="muted">{status.value === 'ready' ? 'האדם הזה כבר לא ברשימה שלך.' : 'טוענים…'}</p>
      </div>
    );
  }
  const l = p.theyShare && !p.paused ? p.location : null;
  const fresh = l ? freshness(l.at, t) : undefined;
  const addr = addressOf(l);
  const dist = l ? distanceTo(p) : '';
  const moving = l ? movingText(l.speed) : '';
  return (
    <div class="view pp" ref={root}>
      <Header title="" />
      <div class="pp-person-head">
        <Avatar name={p.name} emoji={p.emoji} color={p.color} size={72} fresh={fresh} ring />
        <h2 class="pp-person-name">{p.name}</h2>
        {l ? (
          <>
            <p class="pp-person-where">{addr || 'מיקום משותף'}</p>
            <p class="pp-person-meta">
              <span class={`pp-fresh pp-${fresh}`}>{fresh === 'live' ? 'עכשיו' : agoText(l.at, t)}</span>
              {dist && <span>{dist}{dist !== 'לידך' ? ' ממך' : ''}</span>}
              {moving && <span>{moving}</span>}
              {l.battery !== null && (
                <span class={`pp-battery${(l.battery ?? 1) <= 0.15 && !l.charging ? ' pp-warn' : ''}`}>
                  <Icon name={batteryIcon(l.battery, l.charging)} size={16} /> {Math.round((l.battery ?? 0) * 100)}%
                </span>
              )}
            </p>
            {fresh === 'stale' && <p class="small muted pp-stale-note">המיקום מתעדכן כש{p.name.split(' ')[0]} פותח/ת את האפליקציה.</p>}
          </>
        ) : (
          <p class="pp-person-where muted">
            {p.theyShare && p.paused ? 'המיקום מוסתר זמנית' : p.theyShare ? 'מחכים למיקום הראשון' : 'המיקום לא משותף איתך'}
          </p>
        )}
      </div>
      {l && (
        <div class="pp-actions">
          <button class="pp-action pp-primary" onClick={() => directionsTo({ id: pointPlaceId(l.lng, l.lat), name: p.name, lng: l.lng, lat: l.lat, address: addr })}>
            <span class="pp-action-icon"><Icon name="directions" /></span>
            <span>ניווט</span>
          </button>
          <button class="pp-action" onClick={() => flyToPerson(p)}>
            <span class="pp-action-icon"><Icon name="my_location" /></span>
            <span>במפה</span>
          </button>
          <button
            class="pp-action"
            onClick={async () => {
              const text = `${p.name}: ${addr || ''} https://www.openstreetmap.org/?mlat=${l.lat.toFixed(5)}&mlon=${l.lng.toFixed(5)}`;
              try {
                await navigator.clipboard.writeText(text);
                toast('הכתובת הועתקה');
              } catch {
                toast(text);
              }
            }}
          >
            <span class="pp-action-icon"><Icon name="content_copy" /></span>
            <span>העתקה</span>
          </button>
        </div>
      )}
      {!p.theyShare && (
        <div class="pp-card">
          <div class="pp-card-title">רוצה לראות איפה {p.name}?</div>
          <p class="small muted">נשלח בקשה. אם {p.name.split(' ')[0]} יאשר/תאשר, תראו אחד את השני על המפה, לזמן שיבחר/תבחר.</p>
          <button class="btn tonal" disabled={p.iAsked} onClick={() => void ask(p)}>
            <Icon name="send" /> {p.iAsked ? 'הבקשה נשלחה' : 'בקשה לראות מיקום'}
          </button>
        </div>
      )}
      {p.theyShare?.until && <p class="small muted pp-their-share">{p.name} משתף/ת איתך {shareLeft(p.theyShare.until, t, tz())}</p>}
      <h3 class="pp-section">המיקום שלי</h3>
      {p.askedMe && !p.iShare && <p class="small pp-asked"><Icon name="waving_hand" size={16} /> {p.name} ביקש/ה לראות את המיקום שלך</p>}
      <ShareMine p={p} />
      <Alerts p={p} />
      {p.alertsAboutMe.length > 0 && (
        <section aria-label="התראות עליך">
          <h3 class="pp-section">התראות של {p.name} עליך</h3>
          {p.alertsAboutMe.map((a) => (
            <div key={a.id} class="pp-alert">
              <Icon name="notifications" />
              <span class="pp-alert-text">{alertSummary(a.kind, a.label)}</span>
              <button class="icon-btn" aria-label="ביטול ההתראה" title="ביטול" onClick={() => void deleteAlert(a.id)}>
                <Icon name="close" />
              </button>
            </div>
          ))}
        </section>
      )}
      <button
        class="pp-link-row pp-danger"
        onClick={() => {
          if (confirmRemove(p)) void removePerson(p).then(back);
        }}
      >
        <Icon name="person_remove" /> הסרה מהרשימה
      </button>
    </div>
  );
}

let removeArmed: { id: string; at: number } | null = null;
/** A second tap within 4 seconds confirms (no browser dialogs). */
function confirmRemove(p: Person): boolean {
  if (removeArmed && removeArmed.id === p.id && Date.now() - removeArmed.at < 4000) {
    removeArmed = null;
    return true;
  }
  removeArmed = { id: p.id, at: Date.now() };
  toast(`להסיר את ${p.name}? השיתוף ייפסק בשני הכיוונים. הקישו שוב לאישור.`, { label: 'הסרה', run: () => void removePerson(p).then(back) });
  return false;
}

// ---------- adding someone ----------

async function shareLink(url: string, name: string) {
  const text = `${name} משתף/ת איתך מיקום בנדב מפות. פותחים את הקישור ורואים אחד את השני על המפה:`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'נדב מפות · אנשים', text, url });
      return true;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('הקישור הועתק. אפשר להדביק אותו בוואטסאפ.');
  } catch {
    toast(url);
  }
  return true;
}

export function AddPersonView(_: ViewProps) {
  const root = useWatching();
  const m = me.value;
  const [choice, setChoice] = useState<ShareFor>('1h');
  const [link, setLink] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [alsoShare, setAlsoShare] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!m) return <div class="view pp" ref={root}><Header title="הוספת אדם" /><Onboarding /></div>;
  const clean = normalizeCode(code);
  return (
    <div class="view pp" ref={root}>
      <Header title="הוספת אדם" />
      <section class="pp-card pp-invite">
        <div class="pp-card-title"><Icon name="link" /> שליחת קישור</div>
        <p class="small muted">מי שיפתח את הקישור יראה את המיקום שלך למשך הזמן שבחרת, ויוכל לשתף אותך בחזרה.</p>
        <DurationPicker value={choice} onChange={(v) => (setChoice(v), setLink(null))} label="לכמה זמן לשתף" />
        <button
          class="btn primary big full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const u = link ?? (await createInvite(choice));
            setBusy(false);
            if (!u) return;
            setLink(u);
            await shareLink(u, m.name);
          }}
        >
          <Icon name="share" /> {busy ? 'רגע…' : 'שליחת קישור הזמנה'}
        </button>
        {link && <p class="pp-link small" dir="ltr">{link}</p>}
        <p class="small muted">הקישור בתוקף 7 ימים.</p>
      </section>
      <div class="pp-or"><span>או</span></div>
      <section class="pp-card">
        <div class="pp-card-title"><Icon name="qr_code_2" /> לפי קוד</div>
        <div class="pp-mycode">
          <span class="small muted">הקוד שלך</span>
          <button
            class="pp-code"
            dir="ltr"
            aria-label={`הקוד שלך ${m.code}, העתקה`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(m.code);
                toast('הקוד הועתק');
              } catch {
                /* shown anyway */
              }
            }}
          >
            {prettyCode(m.code)} <Icon name="content_copy" size={18} />
          </button>
        </div>
        <form
          class="pp-code-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (clean.length < 6 || busy) return;
            setBusy(true);
            const r = await addByCode(clean, alsoShare ? choice : null);
            setBusy(false);
            if (r) {
              toast(alsoShare ? `${r.name} רואה עכשיו את המיקום שלך, ושלחנו בקשה לראות את שלו/ה` : `שלחנו ל${r.name} בקשה`);
              setCode('');
              back();
            }
          }}
        >
          <label class="small muted" for="pp-code">הקוד של החבר</label>
          <input id="pp-code" class="input pp-code-input" dir="ltr" maxLength={9} autoComplete="off" autoCapitalize="characters" spellcheck={false} placeholder="K7M 2QX" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
          <Switch title="לשתף גם את המיקום שלי" sub={SHARE_CHOICES.find((c) => c.id === choice)!.label} checked={alsoShare} onChange={setAlsoShare} />
          <button class="btn tonal full" disabled={clean.length < 6 || busy}>
            <Icon name="person_add" /> הוספה
          </button>
        </form>
      </section>
    </div>
  );
}

// ---------- opening an invite link ----------

function inviteDuration(s: number | null): string {
  if (s === null) return 'ללא הגבלה';
  if (s <= 3700) return 'לשעה';
  return `ל-${Math.round(s / 3600)} שעות`;
}

export function InviteView(_: ViewProps) {
  const root = useWatching();
  const token = pendingInvite.value;
  const st = status.value;
  const [preview, setPreview] = useState<InvitePreview | null | 'error' | undefined>(undefined);
  const [choice, setChoice] = useState<ShareFor | null>('1h');
  const [busy, setBusy] = useState(false);
  const ready = st === 'ready' && !!me.value;
  useEffect(() => {
    if (!token || st === 'off' || st === 'loading') return;
    if (preview === undefined) void peekInvite(token).then(setPreview);
  }, [token, st]);
  const close = () => {
    pendingInvite.value = null;
    back();
  };
  if (!token) return <div class="view pp" ref={root}><Header title="הזמנה" icon="close" onBack={back} /><p class="muted">ההזמנה טופלה.</p></div>;
  if (preview === 'error') return <div class="view pp" ref={root}><Header title="הזמנה" icon="close" onBack={close} /><Problem /></div>;
  if (preview === null) {
    return (
      <div class="view pp" ref={root}>
        <Header title="הזמנה" icon="close" onBack={close} />
        <div class="pp-empty"><Icon name="timer" size={36} /><p>פג התוקף של ההזמנה הזאת. בקשו מהחבר קישור חדש.</p></div>
      </div>
    );
  }
  if (preview?.self) {
    return (
      <div class="view pp" ref={root}>
        <Header title="הזמנה" icon="close" onBack={close} />
        <div class="pp-empty"><Icon name="link" size={36} /><p>זה קישור ההזמנה שלך. שלחו אותו לחבר כדי שיראה את המיקום שלך.</p></div>
      </div>
    );
  }
  return (
    <div class="view pp" ref={root}>
      <Header title="" icon="close" onBack={close} />
      <div class="pp-person-head">
        {preview ? <Avatar name={preview.name} emoji={preview.emoji} color={preview.color} size={84} ring fresh="live" /> : <span class="pp-avatar pp-skel" style={{ '--pp-size': '84px' }} />}
        <h2 class="pp-person-name">{preview ? `${preview.name} משתף/ת איתך מיקום` : 'הזמנה לשיתוף מיקום'}</h2>
        {preview && <p class="pp-person-where muted">{inviteDuration(preview.shareSeconds)}</p>}
      </div>
      {!ready ? (
        <>
          <p class="pp-lead">כדי לראות את {preview?.name ?? 'החבר'} על המפה, בחרו איך תיראו. בלי טלפון ובלי סיסמה.</p>
          <ProfileForm cta="המשך" />
        </>
      ) : (
        <div class="pp-card">
          <div class="pp-card-title">לשתף גם את המיקום שלך עם {preview?.name}?</div>
          <div class="segmented pp-duration" role="group" aria-label="לכמה זמן לשתף">
            {SHARE_CHOICES.map((c) => (
              <button key={c.id} type="button" aria-pressed={choice === c.id} onClick={() => setChoice(c.id)}>{c.label}</button>
            ))}
            <button type="button" aria-pressed={choice === null} onClick={() => setChoice(null)}>לא עכשיו</button>
          </div>
          <button
            class="btn primary big full"
            disabled={busy || !preview}
            onClick={async () => {
              setBusy(true);
              const r = await acceptInvite(token, choice);
              setBusy(false);
              if (!r) return;
              toast(`${r.name} נוסף/ה לאנשים שלך`);
              // Replace the invite screen in one step (the history sync follows the stack depth).
              openPerson(r.id, true);
              setTimeout(() => {
                const p = personById(r.id);
                if (p) flyToPerson(p);
              }, 80);
            }}
          >
            {busy ? 'רגע…' : 'אישור'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- me ----------

export function MeView(_: ViewProps) {
  const root = useWatching();
  const m = me.value;
  const [armed, setArmed] = useState(false);
  if (!m) return <div class="view pp" ref={root}><Header title="הפרופיל שלי" /><Onboarding /></div>;
  return (
    <div class="view pp" ref={root}>
      <Header title="הפרופיל שלי" />
      <ProfileForm cta="שמירה" onDone={() => toast('נשמר')} />
      <h3 class="pp-section">פרטיות</h3>
      <Switch
        title="הסתרת המיקום שלי"
        sub={m.paused ? 'אף אחד לא רואה אותך עכשיו. השיתופים נשמרים.' : 'מסתיר מכולם בבת אחת, בלי לבטל שיתופים'}
        checked={m.paused}
        onChange={(v) => void setPaused(v)}
      />
      <Switch title="הצגת האנשים במפה" sub="הבועות של החברים על המפה הראשית. חוזר בכל פתיחה של האפליקציה" checked={onMap.value} onChange={(v) => (onMap.value = v)} />
      <div class="pp-card pp-howto">
        <div class="pp-card-title"><Icon name="info" /> איך זה עובד</div>
        <ul class="small">
          <li>המיקום שלך נשלח רק כשמישהו רואה אותו, ורק כשהאפליקציה פתוחה.</li>
          <li>נשמר רק המיקום האחרון שלך. אין היסטוריה של איפה היית.</li>
          <li>באייפון, אפליקציית ווב לא יכולה לשתף ברקע, אז החברים יראו "עודכן לפני…".</li>
          <li>התראות הגעה ויציאה מופיעות כשהאפליקציה פתוחה אצלך.</li>
        </ul>
      </div>
      <button
        class={`pp-link-row pp-danger${armed ? ' pp-armed' : ''}`}
        onClick={async () => {
          if (!armed) {
            setArmed(true);
            setTimeout(() => setArmed(false), 5000);
            return;
          }
          if (await deleteAccount()) back();
        }}
      >
        <Icon name="delete" /> {armed ? 'הקישו שוב למחיקה סופית' : 'מחיקת החשבון וכל המידע'}
      </button>
    </div>
  );
}

// ---------- the map button ----------

export function PeopleButton() {
  const on = viewStack.value.some((v) => [PEOPLE_VIEW, PERSON_VIEW, ADD_VIEW, ME_VIEW].includes(v.kind));
  const n = requests.value.length;
  return (
    <button
      class={`ctrl live-ctrl pp-ctrl${on ? ' on' : ''}`}
      aria-label={n ? `אנשים, ${n} בקשות` : 'אנשים'}
      title="אנשים"
      aria-pressed={on}
      onClick={() => {
        if (!on) return openPeople();
        while (viewStack.peek().some((v) => [PEOPLE_VIEW, PERSON_VIEW, ADD_VIEW, ME_VIEW].includes(v.kind))) back();
      }}
    >
      <Icon name="group" size={22} />
      {n > 0 && <span class="pp-badge">{n}</span>}
    </button>
  );
}
