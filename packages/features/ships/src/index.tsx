import { currentView, defineFeature } from '@nm/core/app';
import { LiveShipsView, openFromUrl, openShips, setupShips, SHIP_VIEW, ShipsButton, SHIPS_VIEW, ShipView } from './live.tsx';

export default defineFeature({
  id: 'ships',
  title: 'ספינות',
  description: 'ספינות בזמן אמת בכל העולם (AIS): סוג, יעד, זמן הגעה, מהירות ומסלול',
  enabledByDefault: true,
  setup(ctx) {
    ctx.registerView(SHIPS_VIEW, LiveShipsView, { hideTop: true });
    ctx.registerView(SHIP_VIEW, ShipView, { hideTop: true });
    ctx.registerMenuItem({ id: 'live-ships', label: 'ספינות בזמן אמת', icon: 'directions_boat', order: 33, run: () => openShips(currentView.peek().kind === 'menu') });
    // On the map, right under the planes button.
    ctx.registerSlot('controls', ShipsButton, 6);
    setupShips(ctx);
    if (ctx.initialUrl.panel === 'ships') openFromUrl(ctx.initialUrl.ship);
  },
});
