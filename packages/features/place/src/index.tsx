import { useSignal, useSignalEffect } from '@preact/signals';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { droppedPin, formatCoords, formatDistance, distance, OVERTURE_SOURCE, overturePlace, parsePlaceId, type Place, type PlaceDetails } from '@nm/core';
import {
  back,
  currentView,
  defineFeature,
  directionsTo,
  ensureLayer,
  EMPTY,
  home,
  Icon,
  openPlace,
  placeActions,
  placeSections,
  selectedPlace,
  setGeoJSON,
  toast,
  units,
  userLocation,
  type ViewProps,
} from '@nm/core/app';
import { categoryLabel, identifyPlace, placeDetails, placeSummary, reverseGeocode, tools, type PlaceSummary } from '@nm/tools';
import { parseHours, type HoursInfo } from '@nm/core';
import { displayPhone, socialLabel } from './contact.ts';

let map: MapLibreMap;

function shareUrl(p: Place): string {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('place', p.id);
  u.hash = `#17/${p.lat.toFixed(5)}/${p.lng.toFixed(5)}`;
  return u.toString().replace(/%3A/g, ':');
}

async function share(p: Place) {
  const url = shareUrl(p);
  try {
    if (navigator.share) await navigator.share({ title: p.name, text: p.address ? `${p.name}, ${p.address}` : p.name, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    }
  } catch {
    /* user cancelled */
  }
}

function osmNoteUrl(p: Place): string {
  return `https://www.openstreetmap.org/note/new#map=19/${p.lat.toFixed(6)}/${p.lng.toFixed(6)}`;
}

function Hours({ info }: { info: HoursInfo }) {
  const expanded = useSignal(false);
  return (
    <div class="detail-row">
      <span class="detail-icon">
        <Icon name="schedule" />
      </span>
      <div class="detail-body">
        <button class="hours-toggle" aria-expanded={expanded.value} onClick={() => (expanded.value = !expanded.value)}>
          <span class={info.open ? 'ok' : info.open === false ? 'error' : 'muted'}>{info.status}</span>
          <Icon name={expanded.value ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={20} />
        </button>
        {expanded.value && (
          <table class="hours-table">
            <tbody>
              {info.week.map((d) => (
                <tr key={d.day} class={d.today ? 'today' : ''}>
                  <th scope="row">{d.day}</th>
                  <td>{d.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const WHEELCHAIR: Record<string, string> = { yes: 'נגיש לכיסאות גלגלים', limited: 'נגישות חלקית', no: 'לא נגיש לכיסאות גלגלים' };

const telHref = (phone: string) => `tel:${phone.split(';')[0].replace(/[^\d+]/g, '')}`;

function Row({ icon, children, href, onClick, ltr }: { icon: string; children: preact.ComponentChildren; href?: string; onClick?: () => void; ltr?: boolean }) {
  const body = href ? (
    <a class="detail-body ellipsis" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" dir={ltr ? 'ltr' : undefined}>
      {children}
    </a>
  ) : onClick ? (
    <button class="detail-body link-like ellipsis" onClick={onClick} dir={ltr ? 'ltr' : undefined}>
      {children}
    </button>
  ) : (
    <div class="detail-body">{children}</div>
  );
  return (
    <div class="detail-row">
      <span class="detail-icon">
        <Icon name={icon} />
      </span>
      {body}
    </div>
  );
}

function PlaceView({ view }: ViewProps<{ place: Place }>) {
  const place = view.props!.place;
  const details = useSignal<PlaceDetails | null>(null);
  const loading = useSignal(false);
  const hours = useSignal<HoursInfo | null>(null);
  const summary = useSignal<PlaceSummary | null>(null);
  const resolved = useSignal<Place>(place);

  useSignalEffect(() => {
    const p = place;
    resolved.value = p;
    details.value = null;
    hours.value = null;
    summary.value = null;
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      loading.value = true;
      try {
        let d: PlaceDetails | null = null;
        if (p.osm) d = await tools().call(placeDetails, { id: p.id }, { signal: ac.signal });
        else if (p.id.startsWith('ovt:') || (p.id.startsWith('pt:') && p.name !== 'נקודה שנבחרה' && p.name !== 'מיקום')) {
          // A label tapped on the map: find the matching OSM object for hours, accessibility and Wikipedia.
          d = await tools().call(identifyPlace, { name: p.name, lng: p.lng, lat: p.lat }, { signal: ac.signal });
          if (d && !cancelled && p.id.startsWith('pt:')) {
            const better: Place = { ...p, id: d.id, osm: d.osm, category: d.category ?? p.category, address: p.address ?? d.address };
            resolved.value = better;
            openPlace(better, { replace: true });
          }
        }
        if (cancelled) return;
        details.value = d;
        if (d?.openingHours) hours.value = await parseHours(d.openingHours, d.lat, d.lng, p.countryCode ?? 'il');
        if (d && (d.wikipedia || d.wikidata) && !cancelled) {
          summary.value = await tools().call(placeSummary, { wikipedia: d.wikipedia, wikidata: d.wikidata }, { signal: ac.signal });
        }
      } catch {
        /* details are optional; the card still works */
      } finally {
        if (!cancelled) loading.value = false;
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  });

  const p = resolved.value;
  const d = details.value;
  const c = p.contact;
  const cat = categoryLabel(p.category?.key === 'overture' ? p.category : (d?.category ?? p.category));
  const u = userLocation.value;
  const dist = u ? distance([u.lng, u.lat], [p.lng, p.lat]) : null;
  const address = p.address ?? d?.address;
  const phone = d?.phone ?? c?.phone;
  const website = d?.website ?? c?.website;
  const photos = [summary.value?.imageUrl, d?.imageUrl].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);
  const sources = [p.osm || d ? 'OpenStreetMap' : null, p.id.startsWith('ovt:') ? 'Overture Maps' : null, summary.value ? 'ויקיפדיה' : null].filter(Boolean);

  return (
    <article class="view place">
      <div class="place-head">
        <h2 class="place-title">{p.name}</h2>
        <button class="icon-btn filled" aria-label="סגירה" onClick={home}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <p class="place-sub">
        {[cat, d?.cuisine?.split(';')[0], dist !== null ? formatDistance(dist, units.value) : null].filter(Boolean).join(' · ') || formatCoords(p.lng, p.lat)}
      </p>
      {hours.value && (
        <p class="place-open">
          <span class={hours.value.open ? 'ok' : 'error'}>{hours.value.open ? 'פתוח' : 'סגור'}</span>
          {hours.value.status && ` · ${hours.value.status.replace(/^(פתוח|סגור)\s*·?\s*/, '')}`}
        </p>
      )}

      <div class="action-row">
        <button class="action primary" onClick={() => directionsTo(p)}>
          <Icon name="directions" />
          מסלול
        </button>
        {phone && (
          <a class="action" href={telHref(phone)}>
            <Icon name="call" />
            חיוג
          </a>
        )}
        {placeActions.value.map(({ id, Component }) => (
          <Component key={id} place={p} />
        ))}
        <button class="action" onClick={() => void share(p)}>
          <Icon name="share" />
          שיתוף
        </button>
        {website && (
          <a class="action" href={website} target="_blank" rel="noopener noreferrer">
            <Icon name="public" />
            אתר
          </a>
        )}
      </div>

      {photos.length > 0 && (
        <div class="photo-strip">
          {photos.map((src) => (
            <img key={src} src={src} alt="" loading="lazy" referrerpolicy="no-referrer" onError={(e) => ((e.target as HTMLElement).style.display = 'none')} />
          ))}
        </div>
      )}

      {summary.value && (
        <p class="about">
          {summary.value.extract.length > 320 ? `${summary.value.extract.slice(0, 300).replace(/\s\S*$/, '')}…` : summary.value.extract}{' '}
          <a class="source" href={summary.value.url} target="_blank" rel="noopener noreferrer">
            ויקיפדיה
          </a>
        </p>
      )}

      <div class="details">
        {address && <Row icon="location_on">{address}</Row>}
        {hours.value && <Hours info={hours.value} />}
        {phone && (
          <Row icon="call" href={telHref(phone)} ltr>
            {displayPhone(phone)}
          </Row>
        )}
        {website && (
          <Row icon="public" href={website} ltr>
            {website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </Row>
        )}
        {c?.email && (
          <Row icon="mail" href={`mailto:${c.email}`} ltr>
            {c.email}
          </Row>
        )}
        {c?.socials?.slice(0, 2).map((url) => (
          <Row key={url} icon="link" href={url}>
            {socialLabel(url)}
          </Row>
        ))}
        {d?.wheelchair && WHEELCHAIR[d.wheelchair] && <Row icon="accessible">{WHEELCHAIR[d.wheelchair]}</Row>}
        <Row
          icon="my_location"
          ltr
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
              toast('הקואורדינטות הועתקו');
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {formatCoords(p.lng, p.lat)}
        </Row>
        {loading.value && !d && (
          <div class="detail-row">
            <span class="detail-icon" />
            <div class="detail-body skeleton" style={{ height: '14px', width: '60%' }} />
          </div>
        )}
      </div>

      {placeSections.value.map(({ id, Component }) => (
        <Component key={id} place={p} />
      ))}

      <footer class="place-footer">
        <a class="btn small" href={osmNoteUrl(p)} target="_blank" rel="noopener noreferrer">
          <Icon name="edit_location_alt" size={18} />
          הצעת עריכה
        </a>
        {p.osm && (
          <a class="btn small" href={`https://www.openstreetmap.org/${p.osm.type}/${p.osm.id}`} target="_blank" rel="noopener noreferrer">
            <Icon name="map" size={18} />
            ב-OpenStreetMap
          </a>
        )}
      </footer>
      {sources.length > 0 && <p class="source-note">מקורות המידע: {sources.join(', ')}</p>}
    </article>
  );
}

function showSelected(p: Place | null) {
  setGeoJSON(
    map,
    'selected-place',
    p
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }] }
      : EMPTY,
  );
}

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46"><path d="M17 1C8.2 1 1 8.1 1 16.9 1 29 17 45 17 45s16-16 16-28.1C33 8.1 25.8 1 17 1z" fill="#ea4335" stroke="#a50e0e" stroke-width="1.5"/><circle cx="17" cy="17" r="6" fill="#a50e0e"/></svg>`;

async function addPinImage(m: MapLibreMap) {
  if (m.hasImage('nm-pin')) return;
  const img = new Image(34, 46);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`;
  await img.decode();
  if (!m.hasImage('nm-pin')) m.addImage('nm-pin', img, { pixelRatio: 1 });
}

async function openDroppedPin(lng: number, lat: number) {
  const pin = droppedPin(lng, lat);
  openPlace(pin);
  try {
    const r = await tools().call(reverseGeocode, { lng, lat });
    if (r && selectedPlace.value?.id === pin.id) {
      const name = r.category?.key === 'highway' || r.category?.key === 'building' || r.category?.key === 'place' ? r.name : pin.name;
      openPlace({ ...pin, name, address: r.address ?? r.name, countryCode: r.countryCode }, { replace: true });
    }
  } catch {
    /* coordinates alone are still useful */
  }
}

export default defineFeature({
  id: 'place',
  title: 'כרטיס מקום',
  enabledByDefault: true,
  setup(ctx) {
    map = ctx.map;
    ctx.registerView('place', PlaceView);

    ctx.onStyle(async (m) => {
      await addPinImage(m);
      setGeoJSON(m, 'selected-place', EMPTY);
      ensureLayer(m, {
        id: 'selected-place-pin',
        type: 'symbol',
        source: 'selected-place',
        layout: { 'icon-image': 'nm-pin', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      }, null);
      showSelected(selectedPlace.value);
    });
    selectedPlace.subscribe((p) => {
      if (ctx.map.getSource('selected-place')) showSelected(p);
    });

    // Tap a label on the base map (shop, café, town) to open its card.
    ctx.onMapClick((e, features) => {
      const o = features.find((x) => x.source === OVERTURE_SOURCE && x.properties?.id);
      if (o) {
        const [lng, lat] = o.geometry.type === 'Point' ? (o.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        openPlace(overturePlace(o.properties, lng, lat));
        return true;
      }
      const f = features.find(
        (x) => x.properties?.name && (x.sourceLayer === 'poi' || x.sourceLayer === 'place' || x.sourceLayer === 'aerodrome_label' || x.sourceLayer === 'mountain_peak'),
      );
      if (f) {
        const coords = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        const name = String(f.properties['name:he'] ?? f.properties.name);
        const cls = f.properties.class ? String(f.properties.class) : undefined;
        const sub = f.properties.subclass ? String(f.properties.subclass) : cls;
        const p: Place = {
          ...droppedPin(coords[0], coords[1], name),
          category: sub ? { key: f.sourceLayer === 'place' ? 'place' : 'amenity', value: sub } : undefined,
        };
        openPlace(p);
        return true;
      }
      // Tapping empty map closes a place card, like Google Maps.
      if (currentView.value.kind === 'place') {
        back();
        return true;
      }
    }, 10);

    ctx.onMapLongPress(({ lng, lat }) => void openDroppedPin(lng, lat));

    // Restore ?place= from a shared link.
    const id = ctx.initialUrl.place;
    if (id) {
      const parsed = parsePlaceId(id);
      if (parsed.point) void openDroppedPin(parsed.point[0], parsed.point[1]);
      else if (parsed.overture) {
        // Overture has no lookup API: find the place in the loaded tiles around the shared view.
        const find = () => {
          const hit = ctx.map.querySourceFeatures(OVERTURE_SOURCE, { sourceLayer: 'place', filter: ['==', ['get', 'id'], parsed.overture!] })[0];
          if (!hit || hit.geometry.type !== 'Point') return false;
          const [lng, lat] = hit.geometry.coordinates as [number, number];
          openPlace(overturePlace(hit.properties, lng, lat));
          return true;
        };
        if (!ctx.initialUrl.view) toast('המקום מהקישור לא נמצא');
        else {
          // The places archive loads lazily; keep looking while its tiles arrive, up to 20 s.
          const until = Date.now() + 20_000;
          const onLoad = () => {
            const found = find();
            if (!found && Date.now() < until) return;
            ctx.map.off('idle', onLoad);
            ctx.map.off('sourcedata', onLoad);
            if (!found) toast('המקום מהקישור לא נמצא');
          };
          ctx.map.on('idle', onLoad);
          ctx.map.on('sourcedata', onLoad);
        }
      }
      else if (parsed.osm) {
        tools()
          .call(placeDetails, { id })
          .then((d) => {
            if (!d) return toast('המקום מהקישור לא נמצא');
            openPlace(d);
            if (!ctx.initialUrl.view) ctx.map.jumpTo({ center: [d.lng, d.lat], zoom: 16 });
          })
          .catch(() => toast('לא הצלחנו לטעון את המקום מהקישור'));
      }
    }
  },
});
