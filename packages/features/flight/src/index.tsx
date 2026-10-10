import { currentView, defineFeature } from '@nm/core/app';
import { FlightView, setupFlight, startFlight } from './flight.tsx';

export default defineFeature({
  id: 'flight',
  title: 'מצב טיסה',
  description: 'רואים את עצמכם על המפה גם בטיסה: מהירות, גובה, מעל איזו מדינה אתם ומתי תנחתו, בלי אינטרנט',
  enabledByDefault: true,
  setup(ctx) {
    ctx.registerView('flight', FlightView, { hideTop: true });
    // From the menu, the new screen takes the menu's place.
    ctx.registerMenuItem({ id: 'flight', label: 'מצב טיסה', icon: 'flight', order: 32, run: () => startFlight(currentView.peek().kind === 'menu') });
    setupFlight(ctx);
    if (ctx.initialUrl.panel === 'flight') startFlight();
  },
});
