import type { Map as MapLibreMap } from 'maplibre-gl';
import { back, currentView, home, Icon, immersive, isEnabled, open, viewStack, type ViewProps } from '@nm/core/app';

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['/'], label: 'חיפוש' },
  { keys: ['+', '-'], label: 'התקרבות והתרחקות' },
  { keys: ['←', '↑', '→', '↓'], label: 'הזזת המפה' },
  { keys: ['Esc'], label: 'סגירת המסך הנוכחי' },
  { keys: ['L'], label: 'שכבות' },
  { keys: ['M'], label: 'מדידת מרחק' },
  { keys: ['?'], label: 'קיצורי המקלדת' },
];

export function ShortcutsView(_: ViewProps) {
  return (
    <div class="view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>קיצורי מקלדת</h2>
      </header>
      <ul class="kbd-list">
        {SHORTCUTS.map((s) => (
          <li key={s.label}>
            <span>{s.label}</span>
            <span class="kbd-keys">
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p class="muted small">הקיצורים לא פועלים בזמן הקלדה בשדה טקסט.</p>
    </div>
  );
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

/** Opens a screen, or closes it when it is already the one showing. */
function toggle(kind: string) {
  if (currentView.value.kind === kind) back();
  else open({ kind });
}

/**
 * Desktop keyboard shortcuts. Letters go by physical key (e.code), so they also work
 * with the Hebrew layout on, where the L key types "ך".
 */
export function installShortcuts(map: MapLibreMap, startMeasure: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (isTyping(e.target) || immersive.value) return;
    const target = e.target as Element | null;
    // MapLibre handles zoom and pan keys itself when the map has focus.
    const onMap = !!target?.closest?.('.maplibregl-canvas-container');
    const onPage = target === document.body || target === document.documentElement || !target;
    const slash = e.key === '/' || (e.code === 'Slash' && !e.shiftKey);
    const help = e.key === '?' || (e.code === 'Slash' && e.shiftKey);
    let handled = true;
    if (help) toggle('shortcuts');
    else if (slash) {
      // The search box handles "/" itself; when a screen hides it, go home first.
      const box = document.querySelector<HTMLInputElement>('input[type="search"]');
      if (!box || box.offsetParent) handled = false;
      else {
        home();
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[type="search"]')?.focus());
      }
    } else if (e.key === 'Escape') {
      if (viewStack.value.length) back();
      else handled = false;
    } else if (e.code === 'KeyL' && !e.shiftKey && isEnabled('layers', true)) toggle('layers');
    else if (e.code === 'KeyM' && !e.shiftKey) {
      if (currentView.value.kind === 'measure') back();
      else startMeasure();
    } else if (!onMap && (e.key === '+' || e.key === '=')) map.zoomIn();
    else if (!onMap && (e.key === '-' || e.key === '_')) map.zoomOut();
    else if (onPage && !e.shiftKey && e.key.startsWith('Arrow')) {
      const step = 100;
      const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (by[e.key]) map.panBy(by[e.key]);
      else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
