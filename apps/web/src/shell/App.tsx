import { signal, useSignal, useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { back, currentView, home, immersive, isDark, sheet, toastMessage, viewStack, type SheetSize } from '@nm/core/app';
import { fabs, homeSections, menuItems, slots, views } from './registry.ts';

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
          →
        </button>
        <h2>תפריט</h2>
      </header>
      <ul class="menu-list">
        {menuItems.value.map((m) => (
          <li key={m.id}>
            <button class="menu-item" onClick={m.run}>
              <span class="menu-icon" aria-hidden="true">
                {m.icon}
              </span>
              {m.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
    return s === 'peek' ? 132 : s === 'half' ? Math.round(vh * 0.48) : vh - 72;
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
  return (
    <section
      ref={ref}
      class={`sheet ${drag.value !== null ? 'dragging' : ''}`}
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
    <section class={`side-panel ${currentView.value.kind === 'home' ? 'is-home' : ''}`} aria-label="לוח מידע">
      <div class="side-body">
        <PanelContent />
      </div>
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
  const overlay = slots.value.filter((s) => s.slot === 'overlay');
  return (
    <>
      {!immersive.value && (
        <>
          <div class="top-bar">
            {top.map(({ Component }, i) => (
              <Component key={i} />
            ))}
          </div>
          <div class={`fabs ${wide.value ? 'wide' : `sheet-${sheet.value}`}`}>
            {fabs.value.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
          {wide.value ? <SidePanel /> : <Sheet />}
        </>
      )}
      {overlay.map(({ Component }, i) => (
        <Component key={i} />
      ))}
      <Toast />
    </>
  );
}
