import { placeVisual } from '../place-visual.ts';
import type { Place } from '../types.ts';
import { ICONS } from './icon-paths.ts';

export { ICONS };

/** Icons that point "forward" or "back" and should mirror in right-to-left layouts. */
const MIRROR = new Set(['arrow_back', 'arrow_forward', 'chevron_left', 'chevron_right', 'keyboard_arrow_left', 'keyboard_arrow_right', 'open_in_new']);

/**
 * A Material Symbols icon by name ("directions", "local_cafe"). Unknown names render as
 * text, so an emoji still works as an icon.
 */
export function Icon({ name, size = 24, class: cls = '', style }: { name: string; size?: number; class?: string; style?: Record<string, string> }) {
  const d = ICONS[name];
  if (!d) {
    return (
      <span class={`icon icon-text ${cls}`} style={{ fontSize: `${Math.round(size * 0.8)}px`, ...style }} aria-hidden="true">
        {name}
      </span>
    );
  }
  return (
    <svg class={`icon ${MIRROR.has(name) ? 'mirror' : ''} ${cls}`} style={style} width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Round, category-coloured badge for a place, like the pins in Google Maps lists. */
export function PlaceBadge({ place, size = 36 }: { place: Pick<Place, 'category'>; size?: number }) {
  const v = placeVisual(place);
  return (
    <span class={`place-badge g-${v.group}`} style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
      <Icon name={v.icon} size={Math.round(size * 0.56)} />
    </span>
  );
}
