import { formatDistance, type RouteStep } from '@nm/core';

/**
 * Valhalla has no Hebrew narrative, so we write our own from the maneuver type.
 * Types: https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
 */
const VERB: Record<number, string> = {
  1: 'צאו לדרך',
  2: 'צאו לדרך ופנו ימינה',
  3: 'צאו לדרך ופנו שמאלה',
  4: 'הגעתם ליעד',
  5: 'הגעתם ליעד, הוא מימין',
  6: 'הגעתם ליעד, הוא משמאל',
  7: 'המשיכו',
  8: 'המשיכו ישר',
  9: 'פנו קלות ימינה',
  10: 'פנו ימינה',
  11: 'פנו חדות ימינה',
  12: 'בצעו פניית פרסה ימינה',
  13: 'בצעו פניית פרסה שמאלה',
  14: 'פנו חדות שמאלה',
  15: 'פנו שמאלה',
  16: 'פנו קלות שמאלה',
  17: 'עלו על הרמפה ישר',
  18: 'עלו על הרמפה מימין',
  19: 'עלו על הרמפה משמאל',
  20: 'צאו ביציאה מימין',
  21: 'צאו ביציאה משמאל',
  22: 'הישארו ישר',
  23: 'הישארו מימין',
  24: 'הישארו משמאל',
  25: 'השתלבו',
  26: 'היכנסו לכיכר',
  27: 'צאו מהכיכר',
  28: 'עלו על המעבורת',
  29: 'רדו מהמעבורת',
  37: 'השתלבו ימינה',
  38: 'השתלבו שמאלה',
};

const ORDINAL = ['', 'הראשונה', 'השנייה', 'השלישית', 'הרביעית', 'החמישית', 'השישית', 'השביעית', 'השמינית'];

export function hebrewInstruction(step: Pick<RouteStep, 'type' | 'street' | 'roundaboutExit'>): string {
  const t = step.type;
  if (t === 26 && step.roundaboutExit) {
    const ord = ORDINAL[step.roundaboutExit] ?? `מספר ${step.roundaboutExit}`;
    return `בכיכר, צאו ביציאה ${ord}${step.street ? ` אל ${step.street}` : ''}`;
  }
  const verb = VERB[t] ?? 'המשיכו';
  if (!step.street || t === 4 || t === 5 || t === 6) return verb;
  if (t === 1 || t === 2 || t === 3) return `${verb} ב${step.street}`;
  if (t === 7 || t === 8 || t === 22) return `${verb} ב${step.street}`;
  if (t === 20 || t === 21) return `${verb} לכיוון ${step.street}`;
  return `${verb} אל ${step.street}`;
}

/** What to say before a maneuver, e.g. "בעוד 300 מ׳, פנו ימינה אל הרצל". */
export function spokenInstruction(step: Pick<RouteStep, 'type' | 'street' | 'roundaboutExit'>, inMeters?: number): string {
  const base = hebrewInstruction(step);
  if (inMeters === undefined || inMeters < 30) return base;
  return `בעוד ${formatDistance(inMeters).replace('מ׳', 'מטר').replace('ק״מ', 'קילומטר')}, ${base}`;
}
