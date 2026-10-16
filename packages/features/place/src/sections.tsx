import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  displayPlusCode,
  distance,
  formatDistance,
  nearbySearchCategory,
  OVERTURE_SOURCE,
  overturePlace,
  placeVisual,
  similarCategories,
  type InfoGroup,
  type InfoItem,
  type Place,
} from '@nm/core';
import { Icon, openPlace, toast, units } from '@nm/core/app';
import { categoryLabel, searchNearby, tools } from '@nm/tools';

/** Google's "לאכול במקום · איסוף עצמי · משלוחים" line. */
export function ServiceOptions({ items }: { items: InfoItem[] }) {
  if (!items.length) return null;
  return (
    <ul class="service-options" aria-label="אפשרויות שירות">
      {items.map((x) => (
        <li key={x.label} class={x.ok ? '' : 'no'}>
          <Icon name={x.ok ? 'check' : 'close'} size={16} />
          {x.label}
        </li>
      ))}
    </ul>
  );
}

const GROUP_ICON: Record<string, string> = {
  נגישות: 'accessible',
  'שירותים במקום': 'wc',
  תזונה: 'eco',
  אווירה: 'groups',
  תשלום: 'payments',
};

/** The "מידע כללי" tab: each group a heading and a list of ✓ / ✗ facts. */
export function Attributes({ groups }: { groups: InfoGroup[] }) {
  return (
    <div class="attributes">
      {groups.map((g) => (
        <section key={g.title} class="attr-group">
          <h3>
            <Icon name={GROUP_ICON[g.title] ?? 'info'} size={20} />
            {g.title}
          </h3>
          <ul>
            {g.items.map((x) => (
              <li key={x.label} class={x.ok ? '' : 'no'}>
                <Icon name={x.ok ? 'check' : 'close'} size={18} />
                {x.label}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The town a short Plus Code is read against: addr:city, else the address' locality. */
export function localityOf(p: Place, tags?: Record<string, string>): string | undefined {
  const city = tags?.['addr:city'];
  if (city) return city;
  const parts = p.address?.split(', ').filter(Boolean) ?? [];
  // Photon addresses end with the country; Overture's with the locality.
  const rest = p.countryCode ? parts.slice(0, -1) : parts;
  return rest.length >= 2 ? rest[rest.length - 1] : undefined;
}

export function PlusCodeRow({ p, tags }: { p: Place; tags?: Record<string, string> }) {
  const { text } = displayPlusCode(p.lat, p.lng, localityOf(p, tags));
  const [code, ...town] = text.split(' ');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('ה-Plus Code הועתק');
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div class="detail-row">
      <span class="detail-icon">
        <Icon name="grid_4x4" />
      </span>
      <button class="detail-body link-like ellipsis" onClick={() => void copy()} aria-label={`Plus Code ${text}, העתקה`}>
        <span dir="ltr" class="plus-code">{code}</span>
        {town.length > 0 && ` ${town.join(' ')}`}
      </button>
      <Icon name="content_copy" size={18} class="row-end" />
    </div>
  );
}

type Similar = { place: Place; dist: number };

const CLOSED = new Set(['permanently_closed', 'temporarily_closed', 'closed']);

/** Overture places of the same kind within `radius` metres, from the tiles the map has loaded. */
function fromTiles(map: MapLibreMap, p: Place, cats: Set<string>, radius: number): Similar[] {
  if (!map.getSource(OVERTURE_SOURCE)) return [];
  const seen = new Set<string>();
  const out: Similar[] = [];
  let features;
  try {
    features = map.querySourceFeatures(OVERTURE_SOURCE, { sourceLayer: 'place' });
  } catch {
    return [];
  }
  for (const f of features) {
    const props = f.properties ?? {};
    const id = String(props.id ?? '');
    if (!id || seen.has(id) || f.geometry.type !== 'Point') continue;
    seen.add(id);
    if (!cats.has(String(props.basic_category)) || CLOSED.has(String(props.operating_status ?? ''))) continue;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    const d = distance([p.lng, p.lat], [lng, lat]);
    if (d > radius) continue;
    const place = overturePlace(props, lng, lat);
    if (!place.name || place.id === p.id || (place.name === p.name && d < 60)) continue;
    out.push({ place, dist: d });
  }
  return out;
}

/** Google's "אנשים מחפשים גם": up to six places like this one nearby, as cards. */
export function SimilarPlaces({ p, category, map }: { p: Place; category?: { key: string; value: string }; map: MapLibreMap }) {
  const list = useSignal<Similar[]>([]);
  const cats = similarCategories(category);
  useEffect(() => {
    list.value = [];
    if (!cats.length) return;
    let live = true;
    const ac = new AbortController();
    const set = new Set(cats);
    const radius = 1000;
    let tiles: Similar[] = [];
    let osm: Similar[] = [];
    const show = () => {
      const names = new Set([p.name, ...tiles.map((x) => x.place.name)]);
      list.value = [...tiles, ...osm.filter((x) => !names.has(x.place.name))].sort((a, b) => a.dist - b.dist).slice(0, 6);
    };
    const fromMap = () => {
      if (!live) return;
      tiles = fromTiles(map, p, set, radius);
      show();
    };
    fromMap();
    // The places archive loads lazily: look again as its tiles arrive, for a while.
    const until = Date.now() + 20_000;
    const onData = () => {
      if (Date.now() > until || tiles.length >= 6) map.off('idle', onData);
      else fromMap();
    };
    map.on('idle', onData);
    // Few businesses on the map after a moment: ask OpenStreetMap too, once.
    const searchId = nearbySearchCategory(category);
    const timer = setTimeout(async () => {
      if (!live || !searchId || tiles.length >= 3) return;
      const dLat = radius / 111_320;
      const dLng = dLat / Math.cos((p.lat * Math.PI) / 180);
      try {
        const found = await tools().call(
          searchNearby,
          { category: searchId as never, bbox: [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat], limit: 20 },
          { signal: ac.signal },
        );
        if (!live) return;
        osm = found
          .filter((x) => x.id !== p.id)
          .map((x) => ({ place: x as Place, dist: distance([p.lng, p.lat], [x.lng, x.lat]) }))
          .filter((x) => x.dist <= radius);
        show();
      } catch {
        /* suggestions are optional */
      }
    }, 2500);
    return () => {
      live = false;
      ac.abort();
      clearTimeout(timer);
      map.off('idle', onData);
    };
  }, [p.id, cats.join()]);

  if (!list.value.length) return null;
  return (
    <section class="similar" aria-labelledby="similar-title">
      <h3 id="similar-title">אנשים מחפשים גם</h3>
      <ul class="similar-row">
        {list.value.map(({ place, dist }) => {
          const v = placeVisual(place);
          return (
            <li key={place.id}>
              <button
                class="similar-card"
                onClick={() => {
                  openPlace(place);
                  map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(map.getZoom(), 17), duration: 600 });
                }}
              >
                <span class={`similar-tile g-${v.group}`} aria-hidden="true">
                  <Icon name={v.icon} size={30} />
                </span>
                <span class="similar-name">{place.name}</span>
                <span class="similar-sub">
                  {[categoryLabel(place.category), formatDistance(dist, units.value)].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
