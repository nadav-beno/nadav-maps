import { defineFeature } from '@nm/core/app';
import { GAME_VIEW, GameButton, GameOverlay, GameView, openGame, setupGame } from './game.tsx';
import './game.css';

export default defineFeature({
  id: 'game',
  title: 'מצב משחק',
  description: 'שומרי השמיים: משחק יירוט דמיוני מעל הטיסות האמיתיות בישראל',
  enabledByDefault: true,
  setup(ctx) {
    ctx.registerView(GAME_VIEW, GameView, { hideTop: true });
    ctx.registerMenuItem({ id: 'game', label: 'מצב משחק: שומרי השמיים', icon: 'sports_esports', order: 34, run: openGame });
    // On the map, under the planes and ships buttons.
    ctx.registerSlot('controls', GameButton, 7);
    ctx.registerSlot('overlay', GameOverlay);
    setupGame(ctx);
    if (ctx.initialUrl.panel === 'game') openGame();
  },
});
