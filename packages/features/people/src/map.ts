import { effect, signal } from '@preact/signals';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { circle, freshness, initialsOf, personColor } from '@nm/core';
import { EMPTY, ensureLayer, immersive, setGeoJSON, type FeatureContext } from '@nm/core/app';
import { onMap, serverNow, visible, watching, type Person } from './store.ts';

/**
 * Friends on the map: a round bubble with their emoji (or first letter) in their colour, a
 * small tail pointing at the spot, their name under it, and a soft circle for the GPS accuracy.
 * Old positions fade. Bubbles are DOM markers so they stay crisp and tappable at any zoom.
 */

export const selectedPerson = signal<string | null>(null);

const markers = new Map<string, { m: maplibregl.Marker; el: HTMLButtonElement; key: string }>();
let map: MapLibreMap;
let openPerson: (id: string) => void = () => {};

function bubbleKey(p: Person, fresh: string, sel: boolean) {
  return [p.name, p.emoji, p.color, fresh, sel, p.location?.charging, p.location && (p.location.battery ?? 1) <= 0.15].join('|');
}

function fill(el: HTMLButtonElement, p: Person, fresh: string, sel: boolean) {
  // Keep MapLibre's own marker classes (they position the element).
  for (const c of [...el.classList]) if (c.startsWith('pp-')) el.classList.remove(c);
  el.classList.add('pp-pin', `pp-${fresh}`);
  if (sel) el.classList.add('pp-selected');
  el.style.setProperty('--pp-color', personColor(p.color));
  el.setAttribute('aria-label', `${p.name} במפה`);
  el.replaceChildren();
  const bubble = document.createElement('span');
  bubble.className = 'pp-bubble';
  const face = document.createElement('span');
  face.className = p.emoji ? 'pp-face pp-emoji' : 'pp-face';
  face.textContent = p.emoji || initialsOf(p.name);
  bubble.append(face);
  const name = document.createElement('span');
  name.className = 'pp-name';
  name.textContent = p.name.split(/\s+/)[0];
  el.append(bubble, name);
}

function render() {
  if (!map) return;
  const show = onMap.value || watching.value > 0;
  const list = show && !immersive.value ? visible.value : [];
  const t = serverNow.value;
  const sel = selectedPerson.value;
  const keep = new Set<string>();
  for (const p of list) {
    const l = p.location!;
    keep.add(p.id);
    const fresh = freshness(l.at, t);
    const key = bubbleKey(p, fresh, sel === p.id);
    let it = markers.get(p.id);
    if (!it) {
      const el = document.createElement('button');
      el.type = 'button';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openPerson(p.id);
      });
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lng, l.lat]).addTo(map);
      it = { m, el, key: '' };
      markers.set(p.id, it);
    }
    if (it.key !== key) {
      fill(it.el, p, fresh, sel === p.id);
      it.key = key;
    }
    it.m.setLngLat([l.lng, l.lat]);
    // The picked person stays on top of the others.
    it.el.style.zIndex = sel === p.id ? '3' : fresh === 'stale' ? '1' : '2';
  }
  for (const [id, it] of markers) {
    if (!keep.has(id)) {
      it.m.remove();
      markers.delete(id);
    }
  }
  renderAccuracy(list);
}

function renderAccuracy(list: Person[]) {
  if (!map.getSource('people-accuracy')) return;
  setGeoJSON(map, 'people-accuracy', {
    type: 'FeatureCollection',
    features: list
      .filter((p) => (p.location!.accuracy ?? 0) > 15)
      .map((p) => ({
        type: 'Feature' as const,
        properties: { color: personColor(p.color) },
        geometry: { type: 'Polygon' as const, coordinates: [circle([p.location!.lng, p.location!.lat], Math.min(p.location!.accuracy!, 3000))] },
      })),
  });
}

export function setupMap(ctx: FeatureContext, open: (id: string) => void) {
  map = ctx.map;
  openPerson = open;
  ctx.onStyle((m) => {
    setGeoJSON(m, 'people-accuracy', EMPTY);
    ensureLayer(m, { id: 'people-accuracy-fill', type: 'fill', source: 'people-accuracy', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 } }, null);
    ensureLayer(m, { id: 'people-accuracy-line', type: 'line', source: 'people-accuracy', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.35, 'line-width': 1 } }, null);
    renderAccuracy(onMap.peek() || watching.peek() > 0 ? visible.peek() : []);
  });
  effect(render);
}

/** Fits the map to everyone I can see (and me). */
export function fitAll(extra?: [number, number] | null) {
  const pts = visible.peek().map((p) => [p.location!.lng, p.location!.lat] as [number, number]);
  if (extra) pts.push(extra);
  if (!pts.length) return;
  if (pts.length === 1) {
    map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 14), duration: 700 });
    return;
  }
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  for (const p of pts) b.extend(p);
  // Small padding: on phones the sheet already takes most of the screen (the map's own padding).
  map.fitBounds(b, { padding: 36, maxZoom: 15, duration: 800 });
}

export function flyToPerson(p: Person) {
  if (!p.location) return;
  map.easeTo({ center: [p.location.lng, p.location.lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
}
