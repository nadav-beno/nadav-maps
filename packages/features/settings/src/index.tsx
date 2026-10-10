import { signal } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  back,
  defineFeature,
  Icon,
  featureCatalog,
  flagOverrides,
  isEnabled,
  open,
  providers,
  theme,
  unitsPref,
  type ThemePref,
  type ViewProps,
} from '@nm/core/app';

let map: MapLibreMap;
const reloadNeeded = signal(false);

/** Android/desktop Chrome lets us show our own install button. */
let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
const canInstall = signal(false);
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as typeof installPrompt;
  canInstall.value = true;
});

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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
      <Header title="התקנה במסך הבית" />
      {isStandalone() ? (
        <p>האפליקציה כבר מותקנת. 🎉</p>
      ) : isIOS() ? (
        <ol class="install-steps">
          <li>
            פתחו את האתר ב-<strong>Safari</strong>.
          </li>
          <li>
            לחצו על כפתור השיתוף <span aria-hidden="true">⬆︎</span> בתחתית המסך.
          </li>
          <li>
            גללו ובחרו <strong>"הוספה למסך הבית"</strong>, ואז <strong>"הוספה"</strong>.
          </li>
          <li>פתחו את האפליקציה מהאייקון החדש. מהאייקון היא נפתחת על מסך מלא ויכולה להשאיר את המסך דלוק בזמן ניווט.</li>
        </ol>
      ) : canInstall.value ? (
        <button
          class="btn primary"
          onClick={async () => {
            await installPrompt?.prompt();
            canInstall.value = false;
          }}
        >
          התקנת האפליקציה
        </button>
      ) : (
        <p>בתפריט הדפדפן בחרו "התקנת האפליקציה" או "הוספה למסך הבית".</p>
      )}
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
          חיפוש: <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a> של komoot
        </li>
        <li>
          מסלולים: <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener noreferrer">Valhalla</a> (שרת FOSSGIS)
        </li>
        <li>
          תחבורה ציבורית: <a href="https://transitous.org" target="_blank" rel="noopener noreferrer">Transitous</a> (MOTIS), <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">לוחות זמנים פתוחים מהמפעילים</a>
        </li>
        <li>
          פרטי מקומות: <a href="https://overpass-api.de" target="_blank" rel="noopener noreferrer">Overpass API</a>
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
        <li>
          תבליט וקווי גובה: נתוני גובה של Mapzen Terrain Tiles (AWS Open Data)
        </li>
        <li>
          תיאורי מקומות: <a href="https://www.wikipedia.org" target="_blank" rel="noopener noreferrer">ויקיפדיה</a> (CC BY-SA) ו-Wikidata
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
    ctx.registerMenuItem({ id: 'settings', label: 'הגדרות', icon: 'settings', order: 80, run: () => open({ kind: 'settings' }) });
    if (!isStandalone()) ctx.registerMenuItem({ id: 'install', label: 'התקנה במסך הבית', icon: 'mobile_arrow_down', order: 85, run: () => open({ kind: 'install' }) });
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
