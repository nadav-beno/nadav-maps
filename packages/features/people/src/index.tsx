import { currentView, defineFeature, open } from '@nm/core/app';
import { flyToPerson, setupMap } from './map.ts';
import { pendingInvite, personById, setAlertTap, startPublishing, startSync } from './store.ts';
import {
  ADD_VIEW, AddPersonView, INVITE_VIEW, InviteView, ME_VIEW, MeView, openPeople, openPerson, PEOPLE_VIEW, PeopleButton, PeopleView,
  PERSON_VIEW, PersonView,
} from './views.tsx';
import './people.css';

/**
 * "אנשים": share your location with the people you choose, for an hour, until the end of the
 * day or for ever; see them live on the map, get directions to them, and be told when they
 * arrive somewhere or leave. Backed by our Supabase project (anonymous sign-in, people_* SQL
 * functions). Inspired by the Find My experience; our own design.
 */
export default defineFeature({
  id: 'people',
  title: 'אנשים',
  description: 'שיתוף מיקום עם חברים ומשפחה: רואים אחד את השני על המפה, לזמן שבוחרים',
  enabledByDefault: true,
  setup(ctx) {
    ctx.registerView(PEOPLE_VIEW, PeopleView, { hideTop: true });
    ctx.registerView(PERSON_VIEW, PersonView, { hideTop: true });
    ctx.registerView(ADD_VIEW, AddPersonView, { hideTop: true });
    ctx.registerView(INVITE_VIEW, InviteView, { hideTop: true });
    ctx.registerView(ME_VIEW, MeView, { hideTop: true });
    ctx.registerTab({ id: 'people', label: 'אנשים', icon: 'group', order: 5, view: PEOPLE_VIEW });
    ctx.registerMenuItem({ id: 'people', label: 'שיתוף מיקום עם חברים', icon: 'share_location', order: 12, run: () => openPeople(currentView.peek().kind === 'menu') });
    // On the map, under the ships button.
    ctx.registerSlot('controls', PeopleButton, 7);
    // Tapping a friend's bubble opens their card and brings them into view.
    setupMap(ctx, (id) => {
      openPerson(id);
      // After the shell has set the map padding for the new screen (it would stop the move).
      setTimeout(() => {
        const p = personById(id);
        if (p) flyToPerson(p);
      }, 80);
    });
    setAlertTap(openPerson);
    startSync();
    startPublishing();
    if (ctx.initialUrl.invite) {
      pendingInvite.value = ctx.initialUrl.invite;
      open({ kind: INVITE_VIEW, props: { url: { panel: 'people' } } });
    } else if (ctx.initialUrl.panel === 'people') openPeople();
  },
});
