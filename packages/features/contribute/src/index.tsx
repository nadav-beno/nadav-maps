import { defineFeature, Icon, isEnabled, open, type FeatureContext, type ViewProps } from '@nm/core/app';

let map: FeatureContext['map'];

/** Current map view as "zoom/lat/lng" for OpenStreetMap links (only when the user taps one). */
function here(minZoom = 17): string {
  const c = map.getCenter();
  return `${Math.max(minZoom, Math.round(map.getZoom()))}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
}

function Card({ icon, title, text, href, onClick }: { icon: string; title: string; text: string; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <Icon name={icon} size={28} />
      <span>
        <strong>{title}</strong>
        <span class="muted small">{text}</span>
      </span>
    </>
  );
  return href ? (
    <a class="contribute-card" href={href} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  ) : (
    <button class="contribute-card" style={{ border: 0, width: '100%', textAlign: 'start' }} onClick={onClick}>
      {body}
    </button>
  );
}

function ContributeView(_: ViewProps) {
  return (
    <div class="view">
      <header class="view-header">
        <h2>תרומה למפה</h2>
      </header>
      <p class="muted">
        המפה בנויה על OpenStreetMap, מפה פתוחה שכל אחד יכול לערוך. תיקון שתעשו שם מגיע לכאן אחרי כמה ימים, ולכל מי שמשתמש במפה.
      </p>
      <Card icon="add_location_alt" title="הוספת מקום חסר" text="עסק, כתובת או מקום שלא מופיעים במפה." href={`https://www.openstreetmap.org/edit#map=${here(18)}`} />
      <Card icon="edit_location_alt" title="דיווח על טעות" text="משהו לא נכון באזור שעל המסך? כתבו הערה ומתנדבים יתקנו." href={`https://www.openstreetmap.org/note/new#map=${here()}`} />
      {isEnabled('photos', true) && (
        <Card icon="add_a_photo" title="התמונות שלי על המפה" text="הוסיפו תמונות מהטלפון וראו אותן במקום שבו צולמו. נשאר רק אצלכם." onClick={() => open({ kind: 'photos' })} />
      )}
      <Card icon="map" title="הצטרפות לקהילת OpenStreetMap" text="מדריך קצר למתחילים בעריכת המפה." href="https://learnosm.org/he/" />
    </div>
  );
}

export default defineFeature({
  id: 'contribute',
  title: 'תרומה',
  description: 'הוספת מקומות ודיווח על טעויות במפה',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('contribute', ContributeView);
    ctx.registerTab({ id: 'contribute', label: 'תרומה', icon: 'add_location_alt', order: 20, view: 'contribute' });
  },
});
