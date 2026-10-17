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
  /** Base map: OpenMapTiles-schema vector TileJSON, glyph template, Terrarium elevation tiles ('' = no hill shading). */
  vectorTiles: string;
  glyphs: string;
  terrain: string;
  /**
   * Overture places PMTiles archive ('' = off). "{release}" is replaced with the newest
   * release found in the bucket, since Overture removes old releases after a few months.
   */
  places: string;
  /** Satellite imagery XYZ template for the "satellite" map type ('' = hide that option). */
  satellite: string;
  /**
   * Public transport router (MOTIS API: routes, departures, stops), '' = no transit.
   * Transitous is a free community service for open-source, non-commercial apps.
   */
  transitUrl: string;
  /**
   * TomTom API key ('' = off): live traffic layer, incidents and traffic-aware travel times.
   * In the browser build it is public by nature; restrict it to our domain in TomTom's dashboard.
   */
  tomtomKey: string;
  /**
   * HERE API key ('' = off): the same traffic features, preferred where TomTom has no live
   * traffic (Israel). Public in the browser build too; limit it with HERE's trusted domains.
   */
  hereKey: string;
  /**
   * Live aircraft positions by callsign (adsb.lol's readsb-style API, open data under ODbL),
   * '' = no "find my flight". Only the flight number is sent, never the user's location.
   */
  flightsUrl: string;
  /**
   * Our own static geodata built from OpenStreetMap (scripts/geodata), '' = off. Folder URL ending
   * in "/", may be relative to the page (the web build defaults to the site's own `<base>data/`).
   * Regions with `geodata` in region.ts are answered from `<geodataUrl><region>/` first; Photon and
   * Overpass remain the fallback.
   */
  geodataUrl: string;
  /**
   * Wikimedia Commons API for photos taken near a place ('' = no photo gallery beyond the
   * place's own image). Free files with authors and licences shown next to each photo.
   */
  photosUrl: string;
  /**
   * Open-Meteo air quality API for the air quality layer ('' = layer hidden). Free for
   * non-commercial use without a key, CC BY 4.0; a self-hosted instance takes the same URL.
   */
  airQualityUrl: string;
  /** Identifies us to public servers, as their usage policies ask. */
  userAgent: string;
}

export const DEFAULT_PROVIDERS: ProviderConfig = {
  photonUrl: 'https://photon.komoot.io',
  valhallaUrl: 'https://valhalla1.openstreetmap.de',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  vectorTiles: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  terrain: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  places: 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/{release}/places.pmtiles',
  // Sentinel-2 cloudless 2016 by EOX (CC BY 4.0). Later editions are non-commercial only.
  satellite: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
  transitUrl: 'https://api.transitous.org',
  tomtomKey: '',
  hereKey: '',
  flightsUrl: 'https://api.adsb.lol',
  // Off unless configured: the web build sets it to its own <base>data/ (providersFromEnv).
  geodataUrl: '',
  photosUrl: 'https://commons.wikimedia.org/w/api.php',
  airQualityUrl: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  userAgent: 'NadavMaps/0.2 (+https://github.com/nadav-beno/nadav-maps)',
};

export function providersFromEnv(env: Record<string, string | undefined>, prefix = ''): ProviderConfig {
  const get = (k: string) => env[prefix + k] || undefined;
  return {
    photonUrl: get('PHOTON_URL') ?? DEFAULT_PROVIDERS.photonUrl,
    valhallaUrl: get('VALHALLA_URL') ?? DEFAULT_PROVIDERS.valhallaUrl,
    overpassUrl: get('OVERPASS_URL') ?? DEFAULT_PROVIDERS.overpassUrl,
    vectorTiles: get('VECTOR_TILES_URL') ?? DEFAULT_PROVIDERS.vectorTiles,
    glyphs: get('GLYPHS_URL') ?? DEFAULT_PROVIDERS.glyphs,
    terrain: env[prefix + 'TERRAIN_URL'] ?? DEFAULT_PROVIDERS.terrain,
    places: env[prefix + 'PLACES_URL'] ?? DEFAULT_PROVIDERS.places,
    satellite: env[prefix + 'SATELLITE_URL'] ?? DEFAULT_PROVIDERS.satellite,
    transitUrl: env[prefix + 'TRANSIT_URL'] ?? DEFAULT_PROVIDERS.transitUrl,
    tomtomKey: (env[prefix + 'TOMTOM_KEY'] ?? '').trim(),
    hereKey: (env[prefix + 'HERE_KEY'] ?? '').trim(),
    flightsUrl: env[prefix + 'FLIGHTS_URL'] ?? DEFAULT_PROVIDERS.flightsUrl,
    // Vite's BASE_URL is set in the browser build: default to the data published with the site.
    geodataUrl: withSlash(env[prefix + 'GEODATA_URL'] ?? (env.BASE_URL !== undefined ? `${env.BASE_URL}data/` : DEFAULT_PROVIDERS.geodataUrl)),
    photosUrl: env[prefix + 'PHOTOS_URL'] ?? DEFAULT_PROVIDERS.photosUrl,
    airQualityUrl: env[prefix + 'AIR_QUALITY_URL'] ?? DEFAULT_PROVIDERS.airQualityUrl,
    userAgent: DEFAULT_PROVIDERS.userAgent,
  };
}

function withSlash(u: string): string {
  const t = u.trim();
  return t && !t.endsWith('/') ? `${t}/` : t;
}

/**
 * Lets tests (and developers) switch on key-based sources without a build: `?tomtom=<key>`,
 * `?here=<key>`.
 * Honoured only on localhost, so the public site can't be pointed at someone else's key.
 */
export function withDevOverrides(cfg: ProviderConfig, href: string): ProviderConfig {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return cfg;
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return cfg;
  const tomtom = url.searchParams.get('tomtom');
  const here = url.searchParams.get('here');
  if (!tomtom && !here) return cfg;
  return { ...cfg, ...(tomtom ? { tomtomKey: tomtom } : {}), ...(here ? { hereKey: here } : {}) };
}
