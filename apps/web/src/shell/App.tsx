import { signal, useSignal, useSignalEffect } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { back, currentView, home, Icon, immersive, isDark, open, sheet, toastMessage, viewStack, type SheetSize } from '@nm/core/app';
import { fabs, homeSections, menuItems, slots, tabs, views } from './registry.ts';

const wide = signal(typeof matchMedia === 'function' && matchMedia('(min-width: 768px)').matches);
if (typeof matchMedia === 'function') matchMedia('(min-width: 768px)').addEventListener('change', (e) => (wide.value = e.matches));
export const isWide = wide;

function Home() {
  return (
    <div class="home">
      {homeSections.value.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </div>
  );
}

function Menu() {
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>תפריט</h2>
      </header>
      <div class="account">
        <span class="avatar big" aria-hidden="true">
          <Icon name="person" size={26} />
        </span>
        <div>
          <div style={{ fontWeight: '500' }}>Nadav Maps</div>
          <div class="muted small">בלי חשבון: הכול נשמר במכשיר שלך</div>
        </div>
      </div>
      <ul class="menu-list">
        {menuItems.value.map((m) => (
          <li key={m.id}>
            <button class="menu-item" onClick={m.run}>
              <span class="menu-icon">
                <Icon name={m.icon} />
              </span>
              {m.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which bottom tab is current: home when no screen is open, else the tab whose view is on top. */
const currentTab = () => {
  const v = currentView.value;
  if (v.kind === 'home') return 'home';
  return tabs.value.find((t) => t.view === v.kind && viewStack.value.length === 1)?.id ?? null;
};

/** Google Maps' bottom navigation: Explore, saved places, contribute... */
function Tabs() {
  const cur = currentTab();
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || wide.value) return;
    document.documentElement.style.setProperty('--tabs-h', `${el.offsetHeight}px`);
    return () => document.documentElement.style.setProperty('--tabs-h', '0px');
  });
  const all = [{ id: 'home', label: 'סביבה', icon: 'explore', view: 'home' }, ...tabs.value];
  return (
    <nav ref={ref} class="tabs" aria-label="ניווט ראשי">
      {all.map((t) => (
        <button
          key={t.id}
          class="tab"
          aria-current={cur === t.id ? 'page' : undefined}
          onClick={() => (t.view === 'home' ? home() : open({ kind: t.view }, { reset: true }))}
        >
          <span class="tab-icon">
            <Icon name={cur === t.id ? t.icon : ICON_OUTLINE[t.icon] ?? t.icon} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** Unselected tabs use the outlined icon, like Google's navigation bar. */
const ICON_OUTLINE: Record<string, string> = { explore: 'explore_outline', bookmark: 'bookmark_outline', person: 'person_outline', bookmarks: 'bookmarks_outline' };

function PanelContent() {
  const v = currentView.value;
  if (v.kind === 'home') return <Home />;
  if (v.kind === 'menu') return <Menu />;
  const entry = views.get(v.kind);
  if (!entry) {
    return (
      <div class="view empty">
        <p>המסך הזה לא זמין.</p>
        <button class="btn" onClick={home}>
          חזרה למפה
        </button>
      </div>
    );
  }
  const C = entry.Component;
  return <C key={v.kind} view={v} />;
}

const SNAP: SheetSize[] = ['peek', 'half', 'full'];

/** Mobile bottom sheet with three snap points; drag the handle or tap it to cycle. */
function Sheet() {
  const drag = useSignal<number | null>(null);
  const startY = useRef(0);
  const startH = useRef(0);
  const ref = useRef<HTMLElement>(null);

  const heightFor = (s: SheetSize) => {
    const vh = window.innerHeight;
    const tabsH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabs-h')) || 0;
    return s === 'peek' ? 132 : s === 'half' ? Math.round(vh * 0.48) : vh - 72 - tabsH;
  };

  // Back on the home screen the sheet shrinks so the map is visible.
  useSignalEffect(() => {
    if (viewStack.value.length === 0) sheet.value = 'peek';
  });

  const onDown = (e: PointerEvent) => {
    startY.current = e.clientY;
    startH.current = ref.current?.getBoundingClientRect().height ?? heightFor(sheet.value);
    drag.value = startH.current;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag.value === null) return;
    drag.value = Math.max(80, Math.min(window.innerHeight - 40, startH.current + (startY.current - e.clientY)));
  };
  const onUp = (e: PointerEvent) => {
    if (drag.value === null) return;
    const moved = Math.abs(e.clientY - startY.current);
    const h = drag.value;
    drag.value = null;
    if (moved < 6) {
      const i = SNAP.indexOf(sheet.value);
      sheet.value = SNAP[(i + 1) % SNAP.length];
      return;
    }
    let best: SheetSize = 'half';
    let bestD = Infinity;
    for (const s of SNAP) {
      const d = Math.abs(heightFor(s) - h);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    sheet.value = best;
  };

  const h = drag.value ?? heightFor(sheet.value);
  document.documentElement.style.setProperty('--sheet-h', `${Math.min(h, heightFor('half'))}px`);
  const showTabs = currentTab() !== null;
  return (
    <section
      ref={ref}
      class={`sheet ${drag.value !== null ? 'dragging' : ''} ${showTabs ? '' : 'no-tabs'}`}
      style={{ height: `${h}px` }}
      aria-label="לוח מידע"
    >
      <div
        class="sheet-handle"
        role="slider"
        aria-label="גודל הלוח"
        aria-valuetext={sheet.value === 'peek' ? 'מקופל' : sheet.value === 'half' ? 'חצי מסך' : 'מסך מלא'}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          const i = SNAP.indexOf(sheet.value);
          if (e.key === 'ArrowUp') sheet.value = SNAP[Math.min(2, i + 1)];
          if (e.key === 'ArrowDown') sheet.value = SNAP[Math.max(0, i - 1)];
        }}
      >
        <span />
      </div>
      <div class="sheet-body">
        <PanelContent />
      </div>
    </section>
  );
}

function SidePanel() {
  return (
    <section
      class={`side-panel ${currentView.value.kind === 'home' ? 'is-home' : ''} ${views.get(currentView.value.kind)?.hideTop ? 'no-top' : ''}`}
      aria-label="לוח מידע"
    >
      <div class="side-body">
        <PanelContent />
      </div>
      {currentTab() !== null && <Tabs />}
    </section>
  );
}

function Toast() {
  const t = toastMessage.value;
  if (!t) return null;
  return (
    <div class="toast" role="status">
      <span>{t.text}</span>
      {t.action && (
        <button
          class="toast-action"
          onClick={() => {
            t.action!.run();
            toastMessage.value = null;
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

export function App() {
  useSignalEffect(() => {
    document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
  });
  const top = slots.value.filter((s) => s.slot === 'top');
  const controls = slots.value.filter((s) => s.slot === 'controls');
  const overlay = slots.value.filter((s) => s.slot === 'overlay');
  const showTabs = !wide.value && currentTab() !== null;
  return (
    <>
      {!immersive.value && (
        <>
          <div class="top-bar" hidden={!!views.get(currentView.value.kind)?.hideTop}>
            {top.map(({ Component }, i) => (
              <Component key={i} />
            ))}
          </div>
          {(wide.value || sheet.value !== 'full') && (
            <div class="map-controls">
              {controls.map(({ Component }, i) => (
                <Component key={i} />
              ))}
            </div>
          )}
          <div class={`fabs ${wide.value ? 'wide' : `sheet-${sheet.value}`}`}>
            {fabs.value.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
          {wide.value ? <SidePanel /> : <Sheet />}
          {showTabs && <Tabs />}
        </>
      )}
      {overlay.map(({ Component }, i) => (
        <Component key={i} />
      ))}
      <Toast />
    </>
  );
}
