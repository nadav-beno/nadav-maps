/** Valhalla maneuver type -> Material Symbols icon name, for step lists and the navigation banner. */
export function maneuverIcon(type: number): string {
  switch (type) {
    case 9: case 23: return 'turn_slight_right';
    case 16: case 24: return 'turn_slight_left';
    case 2: case 10: return 'turn_right';
    case 3: case 15: return 'turn_left';
    case 11: return 'turn_sharp_right';
    case 14: return 'turn_sharp_left';
    case 12: return 'u_turn_right';
    case 13: return 'u_turn_left';
    case 18: case 20: return 'ramp_right';
    case 19: case 21: return 'ramp_left';
    case 25: case 37: case 38: return 'merge';
    case 26: case 27: return 'roundabout_right';
    case 28: case 29: return 'directions_boat';
    case 4: case 5: case 6: return 'sports_score';
    default: return 'arrow_upward';
  }
}
