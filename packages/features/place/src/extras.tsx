import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Place, PlaceDetails } from '@nm/core';
import { back, Icon, open, openPlace, PlaceBadge, type ViewProps } from '@nm/core/app';
import { categoryLabel, placePhotos, placesInside, tools, type Photo } from '@nm/tools';

const PHOTO_KEYS = ['tourism', 'historic', 'leisure', 'natural', 'place', 'aeroway', 'railway', 'man_made'];
const PHOTO_VALUES = ['place_of_worship', 'university', 'college', 'theatre', 'museum', 'mall', 'marketplace', 'townhall', 'arts_centre', 'library', 'stadium', 'hospital', 'fountain', 'castle'];

/** Worth looking for photos taken nearby: landmarks, not every corner shop (whose nearby photos are of the street). */
export function photoWorthy(p: Place, d: PlaceDetails | null): boolean {
  if (d?.wikidata || d?.wikipedia || d?.tags.wikimedia_commons) return true;
  const c = d?.category ?? p.category;
  return !!c && (PHOTO_KEYS.includes(c.key) || PHOTO_VALUES.includes(c.value));
}

/** Photos from Wikimedia Commons near the place, for the card's strip and the gallery. */
export function usePhotos(p: Place, d: PlaceDetails | null, ready: boolean): Photo[] {
  const photos = useSignal<Photo[]>([]);
  useEffect(() => {
    photos.value = [];
    if (!ready || p.id.startsWith('pt:') || !photoWorthy(p, d)) return;
    let cancelled = false;
    const big = ['tourism', 'leisure', 'natural', 'place', 'aeroway'].includes((d?.category ?? p.category)?.key ?? '');
    tools()
      .call(placePhotos, { lng: p.lng, lat: p.lat, radius: big ? 250 : 80, limit: 12 })
      .then((r) => !cancelled && (photos.value = r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [p.id, ready]);
  return photos.value;
}

export function PhotosView({ view }: ViewProps<{ title: string; photos: Photo[]; index?: number }>) {
  const { title, photos } = view.props!;
  const sel = useSignal<number | null>(view.props!.index ?? null);
  const ph = sel.value !== null ? photos[sel.value] : null;
  return (
    <div class="view photos-view">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={() => (ph ? (sel.value = null) : back())}>
          <Icon name="arrow_back" />
        </button>
        <h2>תמונות: {title}</h2>
      </header>
      {ph ? (
        <figure class="photo-full">
          <img src={ph.thumbUrl} alt={ph.title} referrerpolicy="no-referrer" />
          <figcaption class="small">
            {ph.title}
            <br />
            <span class="muted">
              {[ph.author, ph.license].filter(Boolean).join(' · ')} ·{' '}
              <a href={ph.pageUrl} target="_blank" rel="noopener noreferrer">
                ויקישיתוף
              </a>
            </span>
          </figcaption>
          <div class="photo-nav">
            <button class="icon-btn" aria-label="הקודמת" disabled={sel.value === 0} onClick={() => (sel.value = Math.max(0, sel.value! - 1))}>
              <Icon name="chevron_right" />
            </button>
            <span class="small muted">
              {sel.value! + 1} / {photos.length}
            </span>
            <button class="icon-btn" aria-label="הבאה" disabled={sel.value === photos.length - 1} onClick={() => (sel.value = Math.min(photos.length - 1, sel.value! + 1))}>
              <Icon name="chevron_left" />
            </button>
          </div>
        </figure>
      ) : (
        <div class="photo-grid">
          {photos.map((x, i) => (
            <button key={x.url} class="photo-cell" aria-label={x.title} onClick={() => (sel.value = i)}>
              <img src={x.thumbUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
      <p class="muted tiny">תמונות חופשיות מוויקישיתוף שצולמו בסביבת המקום. לכל תמונה מוצגים הצלם והרישיון.</p>
    </div>
  );
}

export function openGallery(title: string, photos: Photo[], index?: number) {
  open({ kind: 'place-photos', props: { title, photos, index } });
}

/** A mall, terminal or market with mapped shops inside gets a directory, like Google's. */
export function hasDirectory(p: Place, d: PlaceDetails | null): boolean {
  if (!p.osm || p.osm.type === 'node') return false;
  const t = d?.tags ?? {};
  return t.shop === 'mall' || t.shop === 'department_store' || t.amenity === 'marketplace' || t.aeroway === 'terminal' || t.building === 'retail' || p.category?.value === 'mall';
}

export function DirectoryButton({ p }: { p: Place }) {
  return (
    <button class="detail-row link-row directory-row" onClick={() => open({ kind: 'directory', props: { place: p } })}>
      <Icon name="storefront" size={20} />
      <span>מדריך המקום: חנויות, אוכל ושירותים</span>
      <Icon name="chevron_left" size={20} />
    </button>
  );
}

const FLOOR = (l: string) => (l === '0' ? 'קומת קרקע' : /^-\d/.test(l) ? `קומה ${l} (מרתף)` : `קומה ${l}`);

/** Groups for the directory: food, shops and services. */
function groupOf(d: PlaceDetails): 'food' | 'shop' | 'service' {
  const a = d.tags.amenity;
  if (a && ['restaurant', 'cafe', 'fast_food', 'ice_cream', 'bar', 'food_court'].includes(a)) return 'food';
  if (d.tags.shop) return 'shop';
  return 'service';
}
const GROUPS = { shop: 'חנויות', food: 'אוכל ושתייה', service: 'שירותים' } as const;

export function DirectoryView({ view }: ViewProps<{ place: Place }>) {
  const place = view.props!.place;
  const items = useSignal<PlaceDetails[] | null>(null);
  const error = useSignal(false);
  const q = useSignal('');
  const group = useSignal<'all' | keyof typeof GROUPS>('all');
  useEffect(() => {
    let cancelled = false;
    tools()
      .call(placesInside, { id: place.id })
      .then((r) => !cancelled && (items.value = r))
      .catch(() => !cancelled && (error.value = true));
    return () => {
      cancelled = true;
    };
  }, [place.id]);
  const text = q.value.trim().toLowerCase();
  const list = (items.value ?? [])
    .filter((d) => group.value === 'all' || groupOf(d) === group.value)
    .filter((d) => !text || `${d.name} ${categoryLabel(d.category) ?? ''} ${d.tags.brand ?? ''}`.toLowerCase().includes(text))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const levels = new Set(list.map((d) => d.tags.level).filter(Boolean));
  return (
    <div class="view directory">
      <header class="view-header">
        <button class="icon-btn" aria-label="חזרה" onClick={back}>
          <Icon name="arrow_back" />
        </button>
        <h2>מדריך: {place.name}</h2>
      </header>
      <input class="input" type="search" placeholder="חיפוש חנות או שירות" aria-label="חיפוש במדריך" value={q.value} onInput={(e) => (q.value = (e.target as HTMLInputElement).value)} />
      <div class="chips" role="toolbar" aria-label="סוג">
        {(['all', 'shop', 'food', 'service'] as const).map((g) => (
          <button key={g} class="chip" aria-pressed={group.value === g} onClick={() => (group.value = g)}>
            {g === 'all' ? 'הכול' : GROUPS[g]}
          </button>
        ))}
      </div>
      {items.value === null && !error.value && (
        <ul class="list skeleton-list" role="progressbar" aria-label="טוען">
          {[0, 1, 2].map((i) => (
            <li key={i} class="skeleton-row">
              <span class="skeleton line w60" />
              <span class="skeleton line w40" />
            </li>
          ))}
        </ul>
      )}
      {error.value && <p class="error">לא הצלחנו לטעון את המדריך. נסו שוב בעוד רגע.</p>}
      {items.value && !items.value.length && <p class="muted">עוד לא מופו חנויות בתוך המקום הזה ב-OpenStreetMap.</p>}
      <ul class="list">
        {list.map((d) => (
          <li key={d.id}>
            <button class="list-item" onClick={() => openPlace(d)}>
              <PlaceBadge place={d} size={32} />
              <span class="li-body">
                <span class="li-title">{d.name}</span>
                <span class="li-sub">{[categoryLabel(d.category), levels.size > 0 && d.tags.level ? FLOOR(d.tags.level) : null].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.value && items.value.length > 0 && <p class="muted tiny">{items.value.length} מקומות ממופים · © OpenStreetMap</p>}
    </div>
  );
}
