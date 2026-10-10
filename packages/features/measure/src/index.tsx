import type { Place } from '@nm/core';
import { back, currentView, defineFeature, Icon, open, selectedPlace, type FeatureContext, type ViewProps } from '@nm/core/app';
import { MeasureView, setupMeasure, startMeasure } from './measure.tsx';
import { saveMapImage } from './snapshot.ts';
import { installShortcuts, ShortcutsView } from './shortcuts.tsx';

let map: FeatureContext['map'];

/** From the menu, the new screen takes the menu's place (Google closes the menu too). */
const fromMenu = () => currentView.peek().kind === 'menu';

function measure() {
  startMeasure(undefined, fromMenu());
}

function saveImage() {
  if (fromMenu()) back();
  void saveMapImage(map);
}

/** "Measure distance" on a dropped pin's card: Google's right-click menu entry. */
function MeasureAction({ place }: { place: Place }) {
  if (!place.id.startsWith('pt:')) return null;
  return (
    <button
      class="action"
      onClick={() => {
        selectedPlace.value = null;
        startMeasure([place.lng, place.lat], true);
      }}
    >
      <Icon name="straighten" />
      מדידת מרחק
    </button>
  );
}

const hasKeyboard = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export default defineFeature({
  id: 'measure',
  title: 'מדידה וכלים',
  description: 'מדידת מרחק ושטח, שמירת תמונת מפה וקיצורי מקלדת במחשב',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('measure', (p: ViewProps) => <MeasureView {...p} onSaveImage={() => void saveMapImage(map)} />, { hideTop: true });
    ctx.registerView('shortcuts', ShortcutsView);
    ctx.registerMenuItem({ id: 'measure', label: 'מדידת מרחק', icon: 'straighten', order: 30, run: measure });
    ctx.registerMenuItem({ id: 'map-image', label: 'שמירת תמונת מפה', icon: 'image', order: 31, run: saveImage });
    if (hasKeyboard()) ctx.registerMenuItem({ id: 'shortcuts', label: 'קיצורי מקלדת', icon: 'keyboard', order: 75, run: () => open({ kind: 'shortcuts' }, { replace: fromMenu() }) });
    ctx.registerPlaceAction({ id: 'measure', order: 50, Component: MeasureAction });
    setupMeasure(ctx);
    const uninstall = installShortcuts(ctx.map, () => startMeasure());
    if (ctx.initialUrl.panel === 'measure') startMeasure();
    return uninstall;
  },
});
