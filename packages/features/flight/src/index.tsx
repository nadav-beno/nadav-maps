import { currentView, defineFeature } from '@nm/core/app';
import { FlightView, setupFlight, startFlight } from './flight.tsx';
import { AIRCRAFT_VIEW, AircraftView, LIVE_VIEW, LiveFlightsButton, LiveFlightsView, openLiveFlights, setupLive } from './live.tsx';

export default defineFeature({
  id: 'flight',
  title: 'טיסות',
  description: 'טיסות בעולם בזמן אמת, ומצב טיסה: רואים את עצמכם על המפה גם בטיסה, בלי אינטרנט',
  enabledByDefault: true,
  setup(ctx) {
    ctx.registerView('flight', FlightView, { hideTop: true });
    ctx.registerView(LIVE_VIEW, LiveFlightsView, { hideTop: true });
    ctx.registerView(AIRCRAFT_VIEW, AircraftView, { hideTop: true });
    // From the menu, the new screen takes the menu's place.
    ctx.registerMenuItem({ id: 'live-flights', label: 'טיסות בעולם', icon: 'travel_explore', order: 31, run: () => openLiveFlights(currentView.peek().kind === 'menu') });
    ctx.registerMenuItem({ id: 'flight', label: 'מצב טיסה', icon: 'flight', order: 32, run: () => startFlight(currentView.peek().kind === 'menu') });
    // Always on the map, under the layers button: one tap to every flight in the air.
    ctx.registerSlot('controls', LiveFlightsButton, 5);
    setupFlight(ctx);
    setupLive(ctx);
    if (ctx.initialUrl.panel === 'flight') startFlight();
    if (ctx.initialUrl.panel === 'flights') openLiveFlights();
  },
});
