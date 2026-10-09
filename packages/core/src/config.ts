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
    userAgent: DEFAULT_PROVIDERS.userAgent,
  };
}
