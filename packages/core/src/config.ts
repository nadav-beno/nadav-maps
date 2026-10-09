/**
 * Data provider endpoints. Defaults are the free public servers, which is fine for
 * development and low traffic. When we self-host (phase 3 server), set the env vars
 * (VITE_* in the web build, plain names on the server) and nothing else changes.
 */
export interface ProviderConfig {
  /** Photon geocoder base, e.g. https://photon.komoot.io */
  photonUrl: string;
  /** Valhalla router base, e.g. https://valhalla1.openstreetmap.de */
  valhallaUrl: string;
  /** Overpass API interpreter URL. */
  overpassUrl: string;
  /** Map style URLs. */
  styleLight: string;
  styleDark: string;
  /** Identifies us to public servers, as their usage policies ask. */
  userAgent: string;
}

export const DEFAULT_PROVIDERS: ProviderConfig = {
  photonUrl: 'https://photon.komoot.io',
  valhallaUrl: 'https://valhalla1.openstreetmap.de',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  styleLight: 'https://tiles.openfreemap.org/styles/liberty',
  styleDark: 'https://tiles.openfreemap.org/styles/dark',
  userAgent: 'NadavMaps/0.2 (+https://github.com/nadav-beno/nadav-maps)',
};

export function providersFromEnv(env: Record<string, string | undefined>, prefix = ''): ProviderConfig {
  const get = (k: string) => env[prefix + k] || undefined;
  return {
    photonUrl: get('PHOTON_URL') ?? DEFAULT_PROVIDERS.photonUrl,
    valhallaUrl: get('VALHALLA_URL') ?? DEFAULT_PROVIDERS.valhallaUrl,
    overpassUrl: get('OVERPASS_URL') ?? DEFAULT_PROVIDERS.overpassUrl,
    styleLight: get('STYLE_LIGHT') ?? DEFAULT_PROVIDERS.styleLight,
    styleDark: get('STYLE_DARK') ?? DEFAULT_PROVIDERS.styleDark,
    userAgent: DEFAULT_PROVIDERS.userAgent,
  };
}
