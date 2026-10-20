import { signal, useSignal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  back,
  defineFeature,
  Icon,
  featureCatalog,
  flagOverrides,
  isEnabled,
  embedded,
  open,
  providers,
  toast,
  theme,
  unitsPref,
  type ThemePref,
  type ViewProps,
} from '@nm/core/app';
import { InstallGuide, InstallSheet, installInfo, scheduleInstallHint } from './install.tsx';

let map: MapLibreMap;
const reloadNeeded = signal(false);

function Header({ title }: { title: string }) {
  return (
    <header class="view-header">
      <button class="icon-btn" aria-label="חזרה" onClick={back}>
        <Icon name="arrow_back" />
      </button>
      <h2>{title}</h2>
    </header>
  );
}

function SettingsView(_: ViewProps) {
  const themes: { id: ThemePref; label: string }[] = [
    { id: 'system', label: 'אוטומטי' },
    { id: 'light', label: 'בהיר' },
    { id: 'dark', label: 'כהה' },
  ];
  return (
    <div class="view">
      <Header title="הגדרות" />
      {installInfo().method !== 'installed' && (
        <button class="list-item install-row" onClick={() => open({ kind: 'install' })}>
          <span class="li-icon">
            <Icon name="mobile_arrow_down" size={20} />
          </span>
          <span class="li-body">
            <div class="li-title">התקנה כאפליקציה</div>
            <div class="li-sub">אייקון במסך הבית ומסך מלא, בלי App Store</div>
          </span>
        </button>
      )}
      <h3 class="section-title">מראה</h3>
      <div class="segmented" role="group" aria-label="ערכת צבעים">
        {themes.map((t) => (
          <button key={t.id} aria-pressed={theme.value === t.id} onClick={() => (theme.value = t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <h3 class="section-title">יחידות מידה</h3>
      <div class="segmented" role="group" aria-label="יחידות מידה">
        {(
          [
            ['auto', 'לפי המדינה'],
            ['metric', 'קילומטרים'],
            ['imperial', 'מיילים'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={unitsPref.value === id} onClick={() => (unitsPref.value = id)}>
            {label}
          </button>
        ))}
      </div>
      <h3 class="section-title">יכולות</h3>
      <ul class="list">
        {featureCatalog.value.map((f) => (
          <li key={f.id}>
            <label class="list-item checkable">
              <input
                type="checkbox"
                checked={isEnabled(f.id, f.enabledByDefault)}
                disabled={['search', 'settings'].includes(f.id)}
                onChange={(e) => {
                  flagOverrides.value = { ...flagOverrides.value, [f.id]: (e.target as HTMLInputElement).checked };
                  reloadNeeded.value = true;
                }}
              />
              <span class="li-body">
                <div class="li-title">{f.title}</div>
                {f.description && <div class="li-sub">{f.description}</div>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {reloadNeeded.value && (
        <button class="btn primary" onClick={() => location.reload()}>
          טעינה מחדש כדי להחיל
        </button>
      )}
    </div>
  );
}

function InstallView(_: ViewProps) {
  return (
    <div class="view">
      <Header title="התקנה כאפליקציה" />
      <InstallGuide info={installInfo()} />
    </div>
  );
}

function PrivacyView(_: ViewProps) {
  return (
    <div class="view prose">
      <Header title="פרטיות" />
      <p>
        <strong>בקצרה: המיקום שלך נשאר אצלך.</strong>
      </p>
      <ul>
        <li>המיקום שלך משמש רק כדי להציג אותך במפה ולחשב מסלולים. אנחנו לא שומרים אותו בשום שרת ולא כותבים אותו ללוגים.</li>
        <li>כשמחפשים או מחשבים מסלול, הטקסט והנקודות נשלחים לשירותי המפה (Photon, Valhalla, Overpass, ויקיפדיה) כדי לקבל תשובה. לא נשלח שום מזהה שלך.</li>
        <li>שמורים, רשימות והיסטוריה נשמרים במכשיר שלך בלבד. אפשר למחוק את ההיסטוריה במסך השמורים.</li>
        <li>מפת התמונות לא מעלה תמונות לשום מקום. היא שומרת תמונה מוקטנת, תאריך ומיקום במכשיר בלבד.</li>
        <li>ציר הזמן (כשמפעילים אותו) נשמר במכשיר בלבד, וגם קבצים שמייבאים מגוגל נקראים בדפדפן ולא עולים לשום מקום. כדי לתת שם למקום שביקרת בו נשלחת רק הנקודה לשירות החיפוש, כמו בלחיצה על המפה, ואפשר לכבות את זה. מוחקים יום או הכול מהגדרות ציר הזמן.</li>
        <li>אין פרסומות ואין מעקב שיווקי. דיווח קריסות (אם יופעל) כולל רק את השגיאה, בלי מיקום ובלי כתובת המפה.</li>
        <li>כשיתווספו חשבונות משתמש, תוכלו לייצא את כל המידע ולמחוק את החשבון בכל רגע.</li>
      </ul>
      <p class="muted small">נתוני המפה © תורמי OpenStreetMap, ברישיון ODbL.</p>
    </div>
  );
}

function AboutView(_: ViewProps) {
  return (
    <div class="view prose">
      <Header title="אודות" />
      <p>Nadav Maps היא מפה פתוחה בעברית, שבנויה כולה על מידע פתוח.</p>
      <ul>
        <li>
          נתוני המפה: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© תורמי OpenStreetMap</a> (ODbL)
        </li>
        <li>
          אריחי מפה: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>, סגנון מבוסס <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
        </li>
        <li>
          חיפוש, כתובות ופרטי מקומות בישראל: עותק משלנו של נתוני OpenStreetMap, מתעדכן כל שבוע מקובצי <a href="https://download.geofabrik.de" target="_blank" rel="noopener noreferrer">Geofabrik</a>
        </li>
        <li>
          חיפוש מחוץ לישראל: <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a> של komoot
        </li>
        <li>
          מסלולים: <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener noreferrer">Valhalla</a> (שרת FOSSGIS)
        </li>
        <li>
          תחבורה ציבורית: <a href="https://transitous.org" target="_blank" rel="noopener noreferrer">Transitous</a> (MOTIS), <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">לוחות זמנים פתוחים מהמפעילים</a>
        </li>
        <li>
          חיפוש לפי קטגוריה ופרטי מקומות מחוץ לישראל: <a href="https://overpass-api.de" target="_blank" rel="noopener noreferrer">Overpass API</a>
        </li>
        <li>
          עסקים ומקומות נוספים: <a href="https://overturemaps.org" target="_blank" rel="noopener noreferrer">Overture Maps Foundation</a> (CDLA Permissive 2.0)
        </li>
        <li>
          תצלומי לוויין: <a href="https://s2maps.eu" target="_blank" rel="noopener noreferrer">Sentinel-2 cloudless</a> של EOX, מבוסס על נתוני Copernicus Sentinel (CC BY 4.0)
        </li>
        {providers.value.tomtomKey && (
          <li>
            תנועה בזמן אמת ואירועי תנועה: <a href="https://www.tomtom.com" target="_blank" rel="noopener noreferrer">© TomTom</a>
          </li>
        )}
        {providers.value.hereKey && (
          <li>
            תנועה בזמן אמת ואירועי תנועה: <a href="https://www.here.com" target="_blank" rel="noopener noreferrer">© {new Date().getFullYear()} HERE</a>
          </li>
        )}
        {providers.value.atlasKey && (
          <li>
            מהירויות נמדדות בהונג קונג: Atlas, על בסיס נתוני Transport Department של ממשלת הונג קונג (
            <a href="https://data.gov.hk/en/terms-and-conditions" target="_blank" rel="noopener noreferrer">DATA.GOV.HK</a> ו-CSDI Portal), ללא אישור ממשלתי
          </li>
        )}
        <li>
          תבליט וקווי גובה: נתוני גובה של Mapzen Terrain Tiles (AWS Open Data)
        </li>
        <li>
          תיאורי מקומות: <a href="https://www.wikipedia.org" target="_blank" rel="noopener noreferrer">ויקיפדיה</a> (CC BY-SA) ו-Wikidata
        </li>
        <li>
          מפת העולם הלא מקוונת: <a href="https://www.naturalearthdata.com" target="_blank" rel="noopener noreferrer">Natural Earth</a> (נחלת הכלל), ערים מ-<a href="https://www.geonames.org" target="_blank" rel="noopener noreferrer">GeoNames</a> (CC BY 4.0), שדות תעופה מ-<a href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">OurAirports</a> (נחלת הכלל)
        </li>
        <li>
          מיקום טיסות לפי מספר: <a href="https://adsb.lol" target="_blank" rel="noopener noreferrer">adsb.lol</a> (ODbL)
        </li>
        <li>
          אייקונים: Material Symbols של Google (Apache 2.0) ו-Maki של Mapbox (CC0). גופן: Rubik (OFL)
        </li>
        <li>
          תצוגת המפה: <a href="https://maplibre.org" target="_blank" rel="noopener noreferrer">MapLibre GL JS</a>
        </li>
      </ul>
      <p class="muted small">
        גרסה {__APP_VERSION__} · נבנתה {new Date(__BUILD_TIME__).toLocaleDateString('he-IL')}
      </p>
    </div>
  );
}

const EMBED_SIZES = [
  { id: 's', label: 'קטן', w: 400, h: 300 },
  { id: 'm', label: 'בינוני', w: 600, h: 450 },
  { id: 'l', label: 'גדול', w: 800, h: 600 },
] as const;

/** iframe code for the current map view (and the place or route shown), like Google's "Embed a map". */
export function embedCode(href: string, w: number, h: number): string {
  const u = new URL(href);
  u.searchParams.set('embed', '1');
  const src = u.toString().replace(/&/g, '&amp;').replace(/"/g, '%22');
  return `<iframe src="${src}" width="${w}" height="${h}" style="border:0" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade" title="מפה"></iframe>`;
}

function EmbedView({ view }: ViewProps<{ href?: string }>) {
  const size = useSignal<(typeof EMBED_SIZES)[number]['id']>('m');
  // The address of the screen that opened this one (the map behind the menu).
  const href = view.props?.href ?? location.href;
  const s = EMBED_SIZES.find((x) => x.id === size.value)!;
  const code = embedCode(href, s.w, s.h);
  return (
    <div class="view">
      <Header title="הטמעת מפה באתר" />
      <p class="muted small">מעתיקים את הקוד לאתר שלכם, והמפה מופיעה בו באזור שמוצג עכשיו. אפשר להזיז ולהגדיל אותה, ולחיצה על "פתיחה במפות נדב" פותחת את האפליקציה המלאה.</p>
      <div class="chips" role="radiogroup" aria-label="גודל">
        {EMBED_SIZES.map((x) => (
          <button key={x.id} class="chip" role="radio" aria-checked={size.value === x.id} aria-pressed={size.value === x.id} onClick={() => (size.value = x.id)}>
            {x.label} ({x.w}×{x.h})
          </button>
        ))}
      </div>
      <textarea class="input code" dir="ltr" rows={5} readOnly aria-label="קוד להטמעה" value={code} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
      <button
        class="btn primary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            toast('הקוד הועתק');
          } catch {
            toast('ההעתקה נחסמה. סמנו את הקוד והעתיקו ידנית.');
          }
        }}
      >
        <Icon name="content_copy" size={18} />
        העתקת הקוד
      </button>
    </div>
  );
}

export default defineFeature({
  id: 'settings',
  title: 'הגדרות ומידע',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('settings', SettingsView);
    ctx.registerView('install', InstallView);
    ctx.registerView('privacy', PrivacyView);
    ctx.registerView('about', AboutView);
    ctx.registerView('embed', EmbedView);
    ctx.registerMenuItem({ id: 'embed', label: 'הטמעת מפה באתר', icon: 'code', order: 87, run: () => open({ kind: 'embed', props: { href: location.href } }) });
    ctx.registerMenuItem({ id: 'settings', label: 'הגדרות', icon: 'settings', order: 80, run: () => open({ kind: 'settings' }) });
    ctx.registerSlot('overlay', InstallSheet, 40);
    if (installInfo().method !== 'installed') {
      ctx.registerMenuItem({ id: 'install', label: 'התקנה כאפליקציה', icon: 'mobile_arrow_down', order: 85, run: () => open({ kind: 'install' }) });
      // Opened on a specific screen (e.g. ?panel=install): no hint on top of it this time.
      if (!ctx.initialUrl.panel && !embedded.peek()) scheduleInstallHint();
    }
    ctx.registerMenuItem({
      id: 'report',
      label: 'דיווח על טעות במפה',
      icon: 'flag',
      order: 88,
      run: () => {
        const c = map.getCenter();
        window.open(`https://www.openstreetmap.org/note/new#map=${Math.round(map.getZoom())}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`, '_blank', 'noopener');
      },
    });
    ctx.registerMenuItem({ id: 'privacy', label: 'פרטיות', icon: 'lock', order: 90, run: () => open({ kind: 'privacy' }) });
    ctx.registerMenuItem({ id: 'about', label: 'אודות וקרדיטים', icon: 'info', order: 95, run: () => open({ kind: 'about' }) });
    if (ctx.initialUrl.panel && ['settings', 'install', 'privacy', 'about'].includes(ctx.initialUrl.panel)) open({ kind: ctx.initialUrl.panel });
  },
});
