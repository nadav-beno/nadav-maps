import type { TransitMode } from '../types.ts';
import { Icon } from './icon.tsx';

export const TRANSIT_ICON: Record<TransitMode, string> = {
  bus: 'directions_bus',
  coach: 'airport_shuttle',
  rail: 'train',
  tram: 'tram',
  subway: 'subway',
  ferry: 'directions_boat',
  cable: 'gondola_lift',
  other: 'directions_bus',
};

export const TRANSIT_LABEL: Record<TransitMode, string> = {
  bus: 'אוטובוס',
  coach: 'אוטובוס בין־עירוני',
  rail: 'רכבת',
  tram: 'רכבת קלה',
  subway: 'רכבת תחתית',
  ferry: 'מעבורת',
  cable: 'רכבל',
  other: 'תחבורה ציבורית',
};

/** Default colour when the operator publishes none (Google uses a neutral grey-blue). */
const FALLBACK: Record<TransitMode, string> = {
  bus: '1a73e8',
  coach: '1a73e8',
  rail: '3c4043',
  tram: 'b31412',
  subway: '0b8043',
  ferry: '0277bd',
  cable: '6a1b9a',
  other: '5f6368',
};

export function lineColors(mode: TransitMode, color?: string, textColor?: string): { bg: string; fg: string } {
  const bg = color ?? FALLBACK[mode];
  if (textColor && textColor !== bg) return { bg: `#${bg}`, fg: `#${textColor}` };
  // Pick black or white by contrast.
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 160;
  return { bg: `#${bg}`, fg: light ? '#202124' : '#ffffff' };
}

/** A line badge like Google's: mode icon and the line number on the operator's colour. */
export function LineChip({ mode, line, color, textColor, small }: { mode: TransitMode; line?: string; color?: string; textColor?: string; small?: boolean }) {
  const c = lineColors(mode, color, textColor);
  return (
    <span class={`line-chip ${small ? 'small' : ''}`} style={{ background: c.bg, color: c.fg }} title={TRANSIT_LABEL[mode]}>
      <Icon name={TRANSIT_ICON[mode]} size={small ? 14 : 16} />
      {line && <span class="line-chip-name">{line}</span>}
    </span>
  );
}
