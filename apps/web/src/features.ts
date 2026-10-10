import type { Feature } from '@nm/core/app';
import search from '@nm/feature-search';
import place from '@nm/feature-place';
import location from '@nm/feature-location';
import directions from '@nm/feature-directions';
import navigation from '@nm/feature-navigation';
import saved from '@nm/feature-saved';
import photos from '@nm/feature-photos';
import settings from '@nm/feature-settings';
import layers from '@nm/feature-layers';
import contribute from '@nm/feature-contribute';
import transit from '@nm/feature-transit';

/**
 * Every feature in the app. To add one: `pnpm new-feature <name>`, then list it here.
 * To remove one: delete it from this list (or switch it off with its flag).
 * Order matters only for what appears first in menus and on the home screen.
 */
export const FEATURES: Feature[] = [search, place, location, directions, transit, navigation, layers, saved, contribute, photos, settings];
