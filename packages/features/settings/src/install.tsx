import { signal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { detectInstall, IN_APP_NAME, shouldOfferInstall, type InstallInfo } from '@nm/core';
import { currentView, Icon, load, save, toast } from '@nm/core/app';

/**
 * "Install as an app" without an app store. iPhone/iPad have no install prompt, so we show
 * how to do it from the share sheet, with simple drawings of the buttons (ours, not Apple's
 * artwork). Chrome/Edge on Android and desktop hand us their prompt, so there it is one button.
 */

type PromptEvent = Event & { prompt(): Promise<void>; userChoice?: Promise<{ outcome: string }> };
let promptEvent: PromptEvent | null = null;
export const canPrompt = signal(false);
addEventListener('beforeinstallprompt', (e) => {
  // Our own button and hint replace the browser's mini info bar.
  e.preventDefault();
  promptEvent = e as PromptEvent;
  canPrompt.value = true;
});
addEventListener('appinstalled', () => {
  promptEvent = null;
  canPrompt.value = false;
  installSheet.value = false;
});

export function installInfo(): InstallInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  return detectInstall({
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone,
    displayModeStandalone: matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches,
    canPrompt: canPrompt.value,
  });
}

/** The one-time hint sheet over the map. */
export const installSheet = signal(false);

async function runPrompt(): Promise<void> {
  if (!promptEvent) return;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice?.catch(() => undefined);
  promptEvent = null;
  canPrompt.value = false;
  if (choice?.outcome === 'accepted') installSheet.value = false;
}

// ---------------------------------------------------------------------------
// Drawings. Plain shapes in the UI colours, so they follow light and dark mode.

const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

/** Generic "share": a box with an arrow leaving it. */
export function ShareGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg class="ill-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 9H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.5" {...stroke} />
      <path d="M12 14.5V3m-3.5 3.5L12 3l3.5 3.5" {...stroke} />
    </svg>
  );
}

function AddGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg class="ill-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" {...stroke} />
      <path d="M12 8.5v7M8.5 12h7" {...stroke} />
    </svg>
  );
}

function DotsGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg class="ill-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

function Chevron({ flip }: { flip?: boolean }) {
  return (
    <svg class="ill-glyph" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M14.5 5.5 8 12l6.5 6.5" {...stroke} />
    </svg>
  );
}

function BookGlyph() {
  return (
    <svg class="ill-glyph" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5Zm0 0v13" {...stroke} />
    </svg>
  );
}

function TabsGlyph() {
  return (
    <svg class="ill-glyph" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="7" width="13" height="13" rx="2.5" {...stroke} />
      <path d="M8 4h9.5A2.5 2.5 0 0 1 20 6.5V16" {...stroke} />
    </svg>
  );
}

/** Our icon as it will look on the home screen. */
function AppTile({ size = 44 }: { size?: number }) {
  return (
    <svg class="ill-tile" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="#1a73e8" />
      <path d="M24 10.5c-5.5 0-10 4.3-10 9.7 0 6.6 10 17.3 10 17.3s10-10.7 10-17.3c0-5.4-4.5-9.7-10-9.7Zm0 13.3a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z" fill="#fff" />
    </svg>
  );
}

/** Safari's bottom toolbar (iPhone, iOS 15-18; mirrored in Hebrew) with the share button lit up. */
function BottomBarDrawing() {
  return (
    <div class="ill ill-phone" aria-hidden="true">
      <div class="ill-url">nadav-maps</div>
      <div class="ill-toolbar">
        <Chevron flip />
        <Chevron />
        <span class="ill-hit"><ShareGlyph /></span>
        <BookGlyph />
        <TabsGlyph />
      </div>
    </div>
  );
}

/** An address bar with one button lit: share (iPad, Chrome on iPhone) or "more" (Safari 26). */
function AddressBarDrawing({ lit }: { lit: 'share' | 'dots' }) {
  return (
    <div class="ill ill-phone" aria-hidden="true">
      <div class="ill-toolbar top">
        {lit === 'dots' && <Chevron flip />}
        <div class="ill-url wide">nadav-maps</div>
        <span class="ill-hit">{lit === 'share' ? <ShareGlyph /> : <DotsGlyph />}</span>
      </div>
    </div>
  );
}

/** The share sheet with "Add to Home Screen" lit up. */
function ShareSheetDrawing() {
  return (
    <div class="ill ill-sheet" aria-hidden="true">
      <div class="ill-row muted-row"><span>הוספה לסימניות</span></div>
      <div class="ill-row ill-hit-row"><span>הוספה למסך הבית</span><AddGlyph /></div>
    </div>
  );
}

/** The "Add to Home Screen" screen: our icon and name, and the Add button lit up. */
function AddScreenDrawing() {
  return (
    <div class="ill ill-sheet" aria-hidden="true">
      <div class="ill-nav">
        <span class="ill-hit-text">הוספה</span>
        <strong>הוספה למסך הבית</strong>
        <span class="muted">ביטול</span>
      </div>
      <div class="ill-app">
        <AppTile size={32} />
        <span>Nadav Maps</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Step({ n, children, drawing }: { n: number; children: ComponentChildren; drawing?: ComponentChildren }) {
  return (
    <li class="install-step">
      <span class="install-num" aria-hidden="true">{n}</span>
      <div class="install-step-body">
        <p>{children}</p>
        {drawing}
      </div>
    </li>
  );
}

function copyLink(): void {
  const url = location.href;
  navigator.clipboard?.writeText(url).then(
    () => toast('הקישור הועתק. הדביקו אותו בשורת הכתובת של הדפדפן.'),
    () => toast('לא הצלחנו להעתיק. אפשר להעתיק את הכתובת משורת הכתובת.'),
  );
}

function SafariSteps({ info }: { info: InstallInfo }) {
  const v26 = (info.iosVersion ?? 0) >= 26;
  return (
    <ol class="install-steps">
      {v26 ? (
        <Step n={1} drawing={<AddressBarDrawing lit="dots" />}>
          לחצו על <strong>•••</strong> ליד שורת הכתובת, ואז על <strong>שיתוף</strong>.
        </Step>
      ) : info.device === 'ipad' ? (
        <Step n={1} drawing={<AddressBarDrawing lit="share" />}>
          לחצו על כפתור <strong>השיתוף</strong> <ShareGlyph size={18} /> בפינה העליונה, ליד שורת הכתובת.
        </Step>
      ) : (
        <Step n={1} drawing={<BottomBarDrawing />}>
          לחצו על כפתור <strong>השיתוף</strong> <ShareGlyph size={18} /> בסרגל שבתחתית המסך.
        </Step>
      )}
      <Step n={2} drawing={<ShareSheetDrawing />}>
        גללו מטה ובחרו <strong>"הוספה למסך הבית"</strong>{v26 ? ' (אם לא רואים, לחצו "עוד")' : ''}.
      </Step>
      <Step n={3} drawing={<AddScreenDrawing />}>
        {v26 ? 'השאירו את "פתיחה כאפליקציית רשת" מסומן ולחצו ' : 'לחצו '}
        <strong>"הוספה"</strong>. האייקון יופיע במסך הבית.
      </Step>
    </ol>
  );
}

function BrowserShareSteps({ info }: { info: InstallInfo }) {
  return (
    <ol class="install-steps">
      {info.browser === 'chrome' ? (
        <Step n={1} drawing={<AddressBarDrawing lit="share" />}>
          לחצו על כפתור <strong>השיתוף</strong> <ShareGlyph size={18} /> בצד שורת הכתובת.
        </Step>
      ) : (
        <Step n={1}>
          פתחו את תפריט הדפדפן ובחרו <strong>שיתוף</strong> <ShareGlyph size={18} />.
        </Step>
      )}
      <Step n={2} drawing={<ShareSheetDrawing />}>
        בחרו <strong>"הוספה למסך הבית"</strong>.
      </Step>
      <Step n={3} drawing={<AddScreenDrawing />}>
        לחצו <strong>"הוספה"</strong>. האייקון יופיע במסך הבית.
      </Step>
    </ol>
  );
}

function OpenElsewhere({ info }: { info: InstallInfo }) {
  const ios = info.os === 'ios';
  const target = ios ? 'Safari' : 'Chrome';
  const where = info.inApp && info.inApp !== 'webview' ? `אתם בתוך הדפדפן של ${IN_APP_NAME[info.inApp]}` : ios ? 'הדפדפן הזה' : 'הדפדפן המובנה הזה';
  const intent = !ios ? `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end` : null;
  return (
    <>
      <p class="install-note">
        {where}, ומשם אי אפשר להוסיף אפליקציה למסך הבית. פתחו את הדף ב-<strong>{target}</strong> וחזרו לכאן.
      </p>
      <ol class="install-steps">
        <Step n={1} drawing={<AddressBarDrawing lit="dots" />}>
          לחצו על <strong>•••</strong> או על סמל הדפדפן בפינת המסך, ובחרו <strong>"פתיחה ב-{target}"</strong> או <strong>"פתיחה בדפדפן"</strong>.
        </Step>
        <Step n={2}>
          {ios ? (
            <>
              ב-Safari לחצו על <strong>שיתוף</strong> <ShareGlyph size={18} /> ואז <strong>"הוספה למסך הבית"</strong>.
            </>
          ) : (
            <>
              ב-Chrome פתחו את תפריט <strong>⋮</strong> ובחרו <strong>"התקנת אפליקציה"</strong>.
            </>
          )}
        </Step>
      </ol>
      <div class="install-actions">
        {intent && (
          <a class="btn primary" href={intent}>
            <Icon name="open_in_new" size={18} /> פתיחה ב-Chrome
          </a>
        )}
        <button class={`btn ${intent ? '' : 'tonal'}`} onClick={copyLink}>
          <Icon name="content_copy" size={18} /> העתקת הקישור
        </button>
      </div>
    </>
  );
}

/** The how-to for this browser. Shared by the hint sheet and the "install" screen. */
export function InstallGuide({ info }: { info: InstallInfo }) {
  return (
    <div class="install-guide">
      <div class="install-hero">
        <AppTile size={48} />
        <div>
          <div class="install-hero-title">Nadav Maps במסך הבית</div>
          <div class="muted small">מסך מלא ופתיחה מהירה מהאייקון. בלי App Store.</div>
        </div>
      </div>
      {info.method === 'installed' ? (
        <p>האפליקציה כבר מותקנת. אפשר לפתוח אותה מהאייקון במסך הבית.</p>
      ) : info.method === 'prompt' ? (
        <div class="install-actions">
          <button class="btn primary big" onClick={() => void runPrompt()}>
            <Icon name="mobile_arrow_down" size={20} /> התקנה
          </button>
        </div>
      ) : info.method === 'ios-safari' ? (
        <SafariSteps info={info} />
      ) : info.method === 'ios-browser-share' ? (
        <BrowserShareSteps info={info} />
      ) : info.method === 'open-in-safari' || info.method === 'open-in-browser' ? (
        <OpenElsewhere info={info} />
      ) : info.method === 'mac-safari' ? (
        <p>
          בתפריט <strong>קובץ</strong> של Safari בחרו <strong>"הוספה ל-Dock"</strong>.
        </p>
      ) : info.os === 'android' ? (
        <p>
          בתפריט הדפדפן <strong>⋮</strong> בחרו <strong>"התקנת אפליקציה"</strong> או <strong>"הוספה למסך הבית"</strong>.
        </p>
      ) : (
        <p>
          בשורת הכתובת לחצו על סמל ההתקנה, או בתפריט הדפדפן בחרו <strong>"התקנת האפליקציה"</strong>. יש דפדפנים (כמו Firefox במחשב) שלא תומכים בהתקנה.
        </p>
      )}
    </div>
  );
}

/** One-time hint over the map; the same guide, plus "not now". */
export function InstallSheet() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (installSheet.value) ref.current?.focus();
  }, [installSheet.value]);
  useSignalEffect(() => {
    if (!installSheet.value) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (installSheet.value = false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  if (!installSheet.value) return null;
  const close = () => (installSheet.value = false);
  return (
    <div class="install-layer">
      <div class="install-scrim" onClick={close} />
      <section ref={ref} class="install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" tabIndex={-1}>
        <header class="view-header">
          <h2 id="install-title">התקנה כאפליקציה</h2>
          <button class="icon-btn" aria-label="סגירה" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <InstallGuide info={installInfo()} />
        <button class="btn full install-later" onClick={close}>
          לא עכשיו
        </button>
      </section>
    </div>
  );
}

/** Count visits (one per browser tab session) and offer the hint once, a few seconds in. */
export function scheduleInstallHint(delayMs = 3000): void {
  let visits = load<number>('visits', 0);
  try {
    if (!sessionStorage.getItem('nm:session')) {
      sessionStorage.setItem('nm:session', '1');
      visits += 1;
      save('visits', visits);
    }
  } catch {
    return; // No storage: we could not remember "shown once", so stay quiet.
  }
  setTimeout(() => {
    const show = () => {
      if (!shouldOfferInstall(installInfo(), { visits, shown: load('installHintShown', false) })) return true;
      // Don't cover a place card or a route the user is looking at; wait for the map.
      if (currentView.peek().kind !== 'home') return false;
      save('installHintShown', true);
      installSheet.value = true;
      return true;
    };
    if (show()) return;
    const stop = currentView.subscribe(() => {
      if (show()) queueMicrotask(stop);
    });
  }, delayMs);
}
