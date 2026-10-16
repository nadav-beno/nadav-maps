import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { toast } from './actions.ts';
import { Icon } from './icon.tsx';

/** A QR code's dark modules as one SVG path (1 unit per module, 4-module quiet zone). */
export async function qrPath(text: string): Promise<{ size: number; d: string }> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  // The library writes one byte per character: hand it the UTF-8 bytes.
  qr.addData(String.fromCharCode(...new TextEncoder().encode(text)), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      // Merge runs of dark modules on a row into one rectangle.
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c + 4} ${r + 4}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  return { size: n + 8, d };
}

/**
 * Google's "שליחה לטלפון": a QR code of the link to scan with the phone's camera, plus copy.
 * Rendered over everything (a modal sheet on phones, a card on wide screens).
 */
export function SendToPhone({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const qr = useSignal<{ size: number; d: string } | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    void qrPath(url).then((q) => live && (qr.value = q));
    ref.current?.focus();
    // Escape closes this sheet only, not the screen under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    addEventListener('keydown', onKey, true);
    return () => {
      live = false;
      removeEventListener('keydown', onKey, true);
    };
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    } catch {
      /* clipboard blocked */
    }
  };
  return createPortal(
    <div class="install-layer">
      <div class="install-scrim" onClick={onClose} />
      <section ref={ref} class="install-sheet phone-sheet" role="dialog" aria-modal="true" aria-labelledby="phone-title" tabIndex={-1}>
        <header class="view-header">
          <h2 id="phone-title">שליחה לטלפון</h2>
          <button class="icon-btn" aria-label="סגירה" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <p class="phone-name">{title}</p>
        <div class="qr-box">
          {qr.value ? (
            <svg class="qr" viewBox={`0 0 ${qr.value.size} ${qr.value.size}`} role="img" aria-label="קוד QR של הקישור" shape-rendering="crispEdges">
              <rect width={qr.value.size} height={qr.value.size} fill="#fff" />
              <path d={qr.value.d} fill="#000" />
            </svg>
          ) : (
            <div class="qr skeleton" />
          )}
        </div>
        <p class="muted small phone-help">כוונו את המצלמה של הטלפון אל הקוד ופתחו את הקישור שמופיע.</p>
        <button class="btn full" onClick={() => void copy()}>
          <Icon name="content_copy" size={18} />
          העתקת הקישור
        </button>
      </section>
    </div>,
    document.body,
  );
}
