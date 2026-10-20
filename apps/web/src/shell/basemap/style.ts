import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import { BASEMAP_SOURCE, COUNTRY_NAMES, MERGED_TERRITORIES, OVERTURE_SOURCE, PROMINENT_GROUPS } from '@nm/core';
import { POI_GROUPS, overtureCategoriesIn, overtureColorExpression, overtureIconExpression, poiIconExpression, poiColorExpression } from './poi.ts';

/**
 * Our own base map style, drawn on OpenMapTiles vector tiles (OpenFreeMap, no key) plus
 * Terrarium elevation tiles for hill shading. Owning the style means one look across
 * light/dark, names in the UI language, Google-like clarity (category-coloured places,
 * yellow highways, road shields, 3D buildings) and nothing to break if a third-party
 * style changes.
 *
 * Schema: https://openmaptiles.org/schema/
 */
export interface BasemapSources {
  /** TileJSON URL of an OpenMapTiles-schema vector tileset. */
  vectorTiles: string;
  /** Glyph PBF template with {fontstack} and {range}. Must serve the fonts below. */
  glyphs: string;
  /** Terrarium-encoded elevation PNG tiles ({z}/{x}/{y}); empty disables hill shading. */
  terrain: string;
  /** Overture places as a vector source URL (pmtiles://...); empty or missing = off. */
  places?: string;
  /** Satellite raster XYZ template, used by the "satellite" map type. */
  satellite?: string;
  /** Contour line vector tile template (generated from the elevation tiles), for "terrain". */
  contours?: string;
}

export type MapType = 'default' | 'satellite' | 'terrain';

export interface StyleOptions {
  mapType?: MapType;
  /** Extruded buildings when the map is tilted. */
  buildings3d?: boolean;
  /** Highlight rail, metro and tram lines and their stations. */
  transit?: boolean;
  /** Highlight cycleways and bike-friendly paths. */
  bike?: boolean;
}

/** Layers that paint the ground; the satellite photo replaces them. */
const GROUND = new Set(['waterway', 'landuse', 'landcover', 'park', 'aeroway-area', 'hillshade', 'water', 'building', 'building-3d', 'aeroway-runway']);

export const FONT = {
  regular: ['Noto Sans Regular'],
  bold: ['Noto Sans Bold'],
  italic: ['Noto Sans Italic'],
};

export interface Palette {
  land: string;
  water: string;
  waterLabel: string;
  park: string;
  wood: string;
  grass: string;
  sand: string;
  ice: string;
  residential: string;
  commercial: string;
  industrial: string;
  hospital: string;
  school: string;
  cemetery: string;
  airport: string;
  building: string;
  buildingTop: string;
  buildingLine: string;
  road: string;
  roadCasing: string;
  /** Casing of primary/secondary streets: a touch darker than minor streets'. */
  majorCasing: string;
  minorRoad: string;
  path: string;
  highway: string;
  highwayCasing: string;
  trunk: string;
  trunkCasing: string;
  rail: string;
  boundary: string;
  label: string;
  labelMuted: string;
  roadLabel: string;
  halo: string;
  shield: string;
  shieldLine: string;
  shieldText: string;
  shieldMajorText: string;
  peak: string;
  oneway: string;
  hillShadow: string;
  hillHighlight: string;
}

/**
 * Light palette in the colour families people know from Google Maps (cool grey land,
 * soft green parks, light blue water, white streets, yellow highways). Our own values,
 * picked by eye; no Google style data or assets.
 */
export const LIGHT: Palette = {
  land: '#f1f3f4',
  water: '#aadaff',
  waterLabel: '#2f73c4',
  park: '#ceeacb',
  wood: '#c6e8c5',
  grass: '#d9f0d5',
  sand: '#f6f0de',
  ice: '#f8fbfd',
  residential: '#eceef1',
  commercial: '#eeeef3',
  industrial: '#e8eaed',
  hospital: '#fce8e6',
  school: '#e9edf6',
  cemetery: '#d5ead2',
  airport: '#e8e6f1',
  building: '#e6e6e8',
  buildingTop: '#efeff1',
  buildingLine: '#d6d7da',
  road: '#ffffff',
  roadCasing: '#dadce0',
  majorCasing: '#c4c8ce',
  minorRoad: '#ffffff',
  path: '#c2c6cc',
  highway: '#f9d26a',
  highwayCasing: '#e8a33d',
  trunk: '#fde293',
  trunkCasing: '#eebd55',
  rail: '#bdc1c6',
  boundary: '#8f949a',
  label: '#3c4043',
  labelMuted: '#5f6368',
  roadLabel: '#5f6368',
  halo: '#ffffff',
  shield: '#ffffff',
  shieldLine: '#bdc1c6',
  shieldText: '#3c4043',
  shieldMajorText: '#3b2a00',
  peak: '#7a5a34',
  oneway: '#80868b',
  hillShadow: 'rgba(60, 64, 67, 0.18)',
  hillHighlight: 'rgba(255, 255, 255, 0.2)',
};

/** Dark palette after Google's night map: charcoal land, deep navy water, muted labels. */
export const DARK: Palette = {
  land: '#202124',
  water: '#17263c',
  waterLabel: '#6f9fd2',
  park: '#1c3324',
  wood: '#1b3022',
  grass: '#1f3326',
  sand: '#2b2a25',
  ice: '#2a2d31',
  residential: '#242528',
  commercial: '#26262b',
  industrial: '#252629',
  hospital: '#33282a',
  school: '#25272e',
  cemetery: '#1f2c23',
  airport: '#29283a',
  building: '#2c2d31',
  buildingTop: '#35363b',
  buildingLine: '#3a3b40',
  road: '#3c4043',
  roadCasing: '#2a2b2e',
  majorCasing: '#2a2b2e',
  minorRoad: '#35373a',
  path: '#4a4d52',
  highway: '#7d6a3a',
  highwayCasing: '#4e4227',
  trunk: '#5f5435',
  trunkCasing: '#3f3826',
  rail: '#55585e',
  boundary: '#7b7f86',
  label: '#bdc1c6',
  labelMuted: '#9aa0a6',
  roadLabel: '#9aa0a6',
  halo: '#202124',
  shield: '#3c4043',
  shieldLine: '#5f6368',
  shieldText: '#e8eaed',
  shieldMajorText: '#fde293',
  peak: '#c9b393',
  oneway: '#9aa0a6',
  hillShadow: 'rgba(0, 0, 0, 0.35)',
  hillHighlight: 'rgba(255, 255, 255, 0.04)',
};

const SRC = BASEMAP_SOURCE;

/** Label text in the UI language when OSM has it, otherwise the local name. */
export function nameExpr(lang: string): ExpressionSpecification {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']];
}

const zoomLinear = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification;
const zoomExp = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as unknown as ExpressionSpecification;

const cls = (...values: string[]): ExpressionSpecification => ['match', ['get', 'class'], values, true, false];
// Territories shown as part of another country (packages/core/src/territory.ts): no border
// between the two and no label of their own.
const nameIn = (names: string[], ...keys: string[]): ExpressionSpecification =>
  ['any', ...keys.map((k): ExpressionSpecification => ['in', ['coalesce', ['get', k], ''], ['literal', names]])];
const mergedBorder: ExpressionSpecification = [
  'any',
  ...MERGED_TERRITORIES.flatMap((t): ExpressionSpecification[] => {
    const other = [...Object.values(COUNTRY_NAMES[t.into] ?? {}), ''];
    return [
      ['all', nameIn(t.names, 'adm0_l'), nameIn(other, 'adm0_r')],
      ['all', nameIn(t.names, 'adm0_r'), nameIn(other, 'adm0_l')],
      ['all', ['==', ['get', 'disputed'], 1], ['any', ...t.area.map(([w, s, e, n]): ExpressionSpecification => ['within', { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }])]],
    ];
  }),
];
const mergedLabel: ExpressionSpecification = [
  'any',
  ['in', ['upcase', ['coalesce', ['get', 'iso_a2'], '']], ['literal', MERGED_TERRITORIES.map((t) => t.code.toUpperCase())]],
  nameIn(MERGED_TERRITORIES.flatMap((t) => t.names), 'name', 'name:en', 'name_en', 'name:he', 'name:ar', 'name:latin'),
];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const isBridge: ExpressionSpecification = ['==', ['get', 'brunnel'], 'bridge'];

export function buildStyle(theme: 'light' | 'dark', src: BasemapSources, lang = 'he', opts: StyleOptions = {}): StyleSpecification {
  const mapType = opts.mapType === 'satellite' && !src.satellite ? 'default' : (opts.mapType ?? 'default');
  const satellite = mapType === 'satellite';
  // Over a photo, labels read best light on dark, so satellite uses the dark palette.
  theme = satellite ? 'dark' : theme;
  const c = theme === 'dark' ? DARK : LIGHT;
  const name = nameExpr(lang);
  const layers: LayerSpecification[] = [];
  const add = (l: LayerSpecification) => layers.push(l);

  add({ id: 'background', type: 'background', paint: { 'background-color': c.land } });

  // --- ground: landuse, landcover, parks ---
  add({
    id: 'landuse',
    type: 'fill',
    source: SRC,
    'source-layer': 'landuse',
    paint: {
      'fill-color': [
        'match',
        ['get', 'class'],
        ['residential', 'suburb', 'neighbourhood', 'quarter'], c.residential,
        ['commercial', 'retail'], c.commercial,
        ['industrial', 'garages', 'dam', 'railway', 'quarry'], c.industrial,
        'hospital', c.hospital,
        ['school', 'university', 'college', 'kindergarten', 'library'], c.school,
        'cemetery', c.cemetery,
        ['stadium', 'pitch', 'playground', 'zoo', 'theme_park'], c.grass,
        c.land,
      ],
      'fill-opacity': zoomLinear(9, 0.4, 13, 1),
    },
  });
  add({
    id: 'landcover',
    type: 'fill',
    source: SRC,
    'source-layer': 'landcover',
    paint: {
      'fill-color': [
        'match',
        ['get', 'subclass'],
        ['park', 'garden', 'golf_course', 'recreation_ground', 'village_green'], c.park,
        ['match',
        ['get', 'class'],
        'wood', c.wood,
        ['grass', 'farmland', 'wetland'], c.grass,
        'sand', c.sand,
        'ice', c.ice,
        'rock', c.industrial,
        c.grass],
      ],
      'fill-opacity': ['match', ['get', 'class'], 'farmland', 0.45, 'rock', 0.6, 0.9],
      'fill-antialias': false,
    },
  });
  add({
    id: 'park',
    type: 'fill',
    source: SRC,
    'source-layer': 'park',
    paint: { 'fill-color': c.park, 'fill-opacity': zoomLinear(5, 0.5, 10, 0.9) },
  });
  add({
    id: 'aeroway-area',
    type: 'fill',
    source: SRC,
    'source-layer': 'aeroway',
    minzoom: 10,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': c.airport },
  });

  // --- relief ---
  if (src.terrain) {
    add({
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain',
      maxzoom: 16,
      paint: {
        'hillshade-shadow-color': c.hillShadow,
        'hillshade-highlight-color': c.hillHighlight,
        'hillshade-accent-color': 'rgba(0,0,0,0)',
        'hillshade-exaggeration': mapType === 'terrain' ? zoomLinear(5, 0.75, 12, 0.6, 15, 0.45) : zoomLinear(5, 0.45, 10, 0.3, 15, 0.15),
        'hillshade-illumination-direction': 315,
      },
    });
  }
  if (mapType === 'terrain' && src.contours) {
    const contourColor = theme === 'dark' ? 'rgba(220,200,170,0.35)' : 'rgba(130,95,55,0.38)';
    add({
      id: 'contour',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 10,
      paint: { 'line-color': contourColor, 'line-width': ['match', ['get', 'level'], 1, 1, 0.5] },
    });
    add({
      id: 'contour-label',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 12,
      filter: ['>', ['get', 'level'], 0],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['concat', ['to-string', ['get', 'ele']], ' מ׳'],
        'text-font': FONT.regular,
        'text-size': 10,
      },
      paint: { 'text-color': theme === 'dark' ? '#c9b393' : '#8a6a42', 'text-halo-color': c.halo, 'text-halo-width': 1.2 },
    });
  }

  // --- water ---
  add({
    id: 'waterway',
    type: 'line',
    source: SRC,
    'source-layer': 'waterway',
    filter: notTunnel,
    paint: {
      'line-color': c.water,
      'line-width': [
        'interpolate', ['exponential', 1.5], ['zoom'],
        8, ['match', ['get', 'class'], ['river', 'canal'], 0.8, 0.2],
        14, ['match', ['get', 'class'], ['river', 'canal'], 3, 1],
        18, ['match', ['get', 'class'], ['river', 'canal'], 12, 4],
      ],
    },
    layout: { 'line-cap': 'round' },
  });
  add({ id: 'water', type: 'fill', source: SRC, 'source-layer': 'water', filter: notTunnel, paint: { 'fill-color': c.water } });

  add({
    id: 'aeroway-runway',
    type: 'line',
    source: SRC,
    'source-layer': 'aeroway',
    minzoom: 11,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], cls('runway', 'taxiway')],
    paint: {
      'line-color': theme === 'dark' ? '#3a3a4a' : '#d6d4e3',
      'line-width': [
        'interpolate', ['exponential', 1.5], ['zoom'],
        11, ['match', ['get', 'class'], 'runway', 3, 0.5],
        16, ['match', ['get', 'class'], 'runway', 40, 12],
      ],
    },
  });

  // --- buildings (flat outlines at mid zoom, gentle 3D up close) ---
  add({
    id: 'building',
    type: 'fill',
    source: SRC,
    'source-layer': 'building',
    minzoom: 14,
    ...(opts.buildings3d === false ? {} : { maxzoom: 16 }),
    paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': zoomLinear(14, 0, 15, 1) },
  });
  if (opts.buildings3d !== false) add({
    id: 'building-3d',
    type: 'fill-extrusion',
    source: SRC,
    'source-layer': 'building',
    minzoom: 15.5,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, c.building, 60, c.buildingTop],
      // Grow from flat to full height between z15.5 and z16.5.
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16.5, ['coalesce', ['get', 'render_height'], 6]],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.92,
    },
  });

  // --- roads ---
  roadLayers(add, c);

  // --- rail ---
  add({
    id: 'rail',
    type: 'line',
    source: SRC,
    'source-layer': 'transportation',
    minzoom: 9,
    filter: ['all', cls('rail', 'transit'), notTunnel],
    paint: { 'line-color': c.rail, 'line-width': zoomExp(9, 0.6, 16, 2.5) },
  });
  add({
    id: 'rail-hatch',
    type: 'line',
    source: SRC,
    'source-layer': 'transportation',
    minzoom: 13,
    filter: ['all', cls('rail', 'transit'), notTunnel],
    paint: { 'line-color': c.rail, 'line-width': zoomExp(13, 3, 18, 8), 'line-dasharray': [0.15, 3] },
  });
  if (opts.transit) {
    // Google's transit layer: thick coloured lines, tunnels included, over everything else.
    add({
      id: 'transit-line-casing',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: cls('rail', 'transit'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.land, 'line-width': zoomExp(8, 2.5, 16, 8) },
    });
    add({
      id: 'transit-line',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: cls('rail', 'transit'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'subclass'],
          ['subway'], '#1565c0',
          ['light_rail', 'tram'], '#d32f2f',
          ['monorail', 'funicular', 'narrow_gauge'], '#7b1fa2',
          theme === 'dark' ? '#8ab4f8' : '#3c4a5c',
        ],
        'line-width': zoomExp(8, 1.2, 16, 4.5),
      },
    });
  }
  if (opts.bike) {
    const bikeFilter: ExpressionSpecification = [
      'any',
      ['==', ['get', 'subclass'], 'cycleway'],
      ['in', ['get', 'bicycle'], ['literal', ['designated', 'yes']]],
    ];
    add({
      id: 'bike-lane',
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 11,
      filter: bikeFilter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': theme === 'dark' ? '#6fcf8b' : '#188038',
        'line-width': zoomExp(11, 1, 17, 4),
        'line-opacity': ['match', ['get', 'subclass'], 'cycleway', 1, 0.7],
      },
    });
  }
  add({
    id: 'ferry',
    type: 'line',
    source: SRC,
    'source-layer': 'transportation',
    minzoom: 8,
    filter: cls('ferry'),
    paint: { 'line-color': c.waterLabel, 'line-opacity': 0.6, 'line-width': 1.2, 'line-dasharray': [3, 2] },
  });

  // --- borders ---
  add({
    id: 'boundary-state',
    type: 'line',
    source: SRC,
    'source-layer': 'boundary',
    minzoom: 4,
    filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1], ['!', mergedBorder]],
    paint: { 'line-color': c.boundary, 'line-opacity': 0.5, 'line-width': zoomLinear(4, 0.6, 12, 1.4), 'line-dasharray': [3, 2] },
  });
  add({
    id: 'boundary-country',
    type: 'line',
    source: SRC,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!', mergedBorder]],
    paint: {
      'line-color': c.boundary,
      'line-width': zoomLinear(1, 0.8, 6, 1.4, 12, 2.4),
      'line-dasharray': ['case', ['==', ['get', 'disputed'], 1], ['literal', [2, 2]], ['literal', [1, 0]]] as unknown as number[],
    },
  });

  // --- labels (bottom to top: water, roads, POIs, places) ---
  const halo = { 'text-halo-color': c.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 };
  // Water names sit on water: a soft halo in the water colour reads cleaner than white.
  const waterHalo = { 'text-halo-color': c.water, 'text-halo-width': 1.2, 'text-halo-blur': 0.5 };

  add({
    id: 'waterway-label',
    type: 'symbol',
    source: SRC,
    'source-layer': 'waterway',
    minzoom: 12,
    filter: cls('river', 'canal', 'stream'),
    layout: { 'text-field': name, 'text-font': FONT.italic, 'text-size': 12, 'symbol-placement': 'line', 'text-letter-spacing': 0.05 },
    paint: { 'text-color': c.waterLabel, ...waterHalo },
  });
  add({
    id: 'water-label',
    type: 'symbol',
    source: SRC,
    'source-layer': 'water_name',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {
      'text-field': name,
      'text-font': FONT.italic,
      'text-size': ['match', ['get', 'class'], 'ocean', 16, 'sea', 14, 12],
      'text-max-width': 6,
      'text-letter-spacing': 0.05,
    },
    paint: { 'text-color': c.waterLabel, ...waterHalo },
  });
  add({
    id: 'water-label-line',
    type: 'symbol',
    source: SRC,
    'source-layer': 'water_name',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'text-field': name, 'text-font': FONT.italic, 'text-size': 13, 'symbol-placement': 'line' },
    paint: { 'text-color': c.waterLabel, ...waterHalo },
  });

  add({
    id: 'road-label',
    type: 'symbol',
    source: SRC,
    'source-layer': 'transportation_name',
    minzoom: 13,
    filter: ['!', cls('rail', 'transit', 'ferry')],
    layout: {
      'text-field': name,
      'text-font': FONT.regular,
      'text-size': zoomLinear(13, 10, 17, 13),
      'symbol-placement': 'line',
      'text-max-angle': 30,
      'symbol-spacing': 300,
      'text-padding': 4,
    },
    paint: { 'text-color': c.roadLabel, ...halo },
  });
  add({
    id: 'road-shield',
    type: 'symbol',
    source: SRC,
    'source-layer': 'transportation_name',
    minzoom: 8,
    filter: ['all', ['has', 'ref'], ['<=', ['coalesce', ['get', 'ref_length'], 9], 6], cls('motorway', 'trunk', 'primary', 'secondary')],
    layout: {
      'text-field': ['get', 'ref'],
      'text-font': FONT.bold,
      'text-size': 10.5,
      'icon-image': ['match', ['get', 'class'], ['motorway', 'trunk'], 'nm-shield-major', 'nm-shield'],
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [2, 4, 2, 4],
      'symbol-placement': 'line',
      'symbol-spacing': 400,
      'text-rotation-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: { 'text-color': ['match', ['get', 'class'], ['motorway', 'trunk'], c.shieldMajorText, c.shieldText] },
  });

  add({
    id: 'housenumber',
    type: 'symbol',
    source: SRC,
    'source-layer': 'housenumber',
    minzoom: 17.5,
    layout: { 'text-field': ['get', 'housenumber'], 'text-font': FONT.regular, 'text-size': 10, 'text-padding': 2 },
    paint: { 'text-color': c.labelMuted, 'text-halo-color': c.halo, 'text-halo-width': 1 },
  });

  // Businesses from Overture (phone, website, category) fill in what OSM lacks. They sit
  // under the OSM POI layer, so where both have a place the curated OSM one wins.
  if (src.places) {
    const ovtColor = overtureColorExpression(theme);
    const open: ExpressionSpecification = ['!=', ['get', 'operating_status'], 'permanently_closed'];
    const prominent = overtureCategoriesIn(PROMINENT_GROUPS);
    const ovtLayout = {
      'icon-image': overtureIconExpression(),
      'icon-size': zoomLinear(15, 0.8, 18, 1),
      'text-field': ['get', '@name'],
      'text-font': FONT.bold,
      'text-size': zoomLinear(15, 10.5, 18, 12),
      'text-max-width': 8,
      'text-anchor': 'top',
      'text-offset': [0, 1.0],
      'text-optional': true,
      'symbol-sort-key': ['-', 1, ['coalesce', ['get', 'confidence'], 0]],
      'text-padding': 2,
    } as const;
    add({
      id: 'ovt-poi-minor',
      type: 'symbol',
      source: OVERTURE_SOURCE,
      'source-layer': 'place',
      minzoom: 17,
      filter: ['all', open, ['>=', ['coalesce', ['get', 'confidence'], 0], 0.5], ['!', ['in', ['coalesce', ['get', 'basic_category'], ''], ['literal', prominent]]]],
      layout: ovtLayout as never,
      paint: { 'text-color': ovtColor, ...halo, 'text-halo-width': 1.6 },
    });
    add({
      id: 'ovt-poi',
      type: 'symbol',
      source: OVERTURE_SOURCE,
      'source-layer': 'place',
      minzoom: 15,
      filter: ['all', open, ['>=', ['coalesce', ['get', 'confidence'], 0], 0.6], ['in', ['coalesce', ['get', 'basic_category'], ''], ['literal', prominent]]],
      layout: ovtLayout as never,
      paint: { 'text-color': ovtColor, ...halo, 'text-halo-width': 1.6 },
    });
  }

  // Places of interest: coloured round icon + name in the category colour, like Google.
  const poiColor = poiColorExpression(theme);
  add({
    id: 'poi',
    type: 'symbol',
    source: SRC,
    'source-layer': 'poi',
    minzoom: 14,
    filter: [
      'all',
      ['==', ['geometry-type'], 'Point'],
      ['has', 'name'],
      ['<=', ['coalesce', ['get', 'rank'], 99], ['step', ['zoom'], 6, 15, 14, 16, 30, 17, 99]],
    ],
    layout: {
      'icon-image': poiIconExpression(),
      'icon-size': zoomLinear(14, 0.8, 17, 1),
      'text-field': name,
      'text-font': FONT.bold,
      'text-size': zoomLinear(14, 10.5, 18, 12.5),
      'text-max-width': 8,
      'text-anchor': 'top',
      'text-offset': [0, 1.0],
      'text-optional': true,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      'text-padding': 2,
    },
    paint: { 'text-color': poiColor, ...halo, 'text-halo-width': 1.6 },
  });
  add({
    id: 'peak',
    type: 'symbol',
    source: SRC,
    'source-layer': 'mountain_peak',
    minzoom: 9,
    filter: ['has', 'name'],
    layout: {
      'icon-image': 'nm-peak',
      'text-field': ['case', ['has', 'ele'], ['concat', ['to-string', name], '\n', ['to-string', ['get', 'ele']], ' מ׳'], name],
      'text-font': FONT.regular,
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-optional': true,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: { 'text-color': c.peak, ...halo },
  });
  add({
    id: 'airport-label',
    type: 'symbol',
    source: SRC,
    'source-layer': 'aerodrome_label',
    minzoom: 9,
    layout: {
      'icon-image': 'nm-poi-airport',
      'text-field': name,
      'text-font': FONT.bold,
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.0],
      'text-optional': true,
    },
    paint: { 'text-color': POI_GROUPS.transport.color[theme === 'dark' ? 1 : 0], ...halo },
  });

  // Places: neighbourhoods up to countries.
  add({
    id: 'place-minor',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom: 12,
    filter: cls('suburb', 'neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling', 'locality'),
    layout: {
      'text-field': name,
      'text-font': FONT.bold,
      'text-size': zoomLinear(12, 10.5, 16, 13),
      'text-max-width': 7,
      'text-letter-spacing': 0.04,
      'text-transform': 'uppercase',
    },
    paint: { 'text-color': c.labelMuted, ...halo },
  });
  add({
    id: 'place-village',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom: 10,
    filter: cls('village'),
    layout: { 'text-field': name, 'text-font': FONT.regular, 'text-size': zoomLinear(10, 11, 15, 14), 'text-max-width': 8 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-town',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom: 8,
    filter: cls('town'),
    layout: { 'text-field': name, 'text-font': FONT.regular, 'text-size': zoomLinear(8, 11, 14, 16), 'text-max-width': 8 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-city',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom: 4,
    filter: cls('city'),
    layout: {
      'text-field': name,
      'text-font': FONT.bold,
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['<=', ['coalesce', ['get', 'rank'], 9], 2], 13, 11], 12, ['case', ['<=', ['coalesce', ['get', 'rank'], 9], 2], 22, 18]],
      'text-max-width': 8,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: { 'text-color': c.label, ...halo, 'text-halo-width': 1.8 },
  });
  add({
    id: 'place-state',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    minzoom: 5,
    maxzoom: 8,
    filter: ['all', cls('state', 'province'), ['!', mergedLabel]],
    layout: { 'text-field': name, 'text-font': FONT.regular, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 8 },
    paint: { 'text-color': c.labelMuted, ...halo },
  });
  add({
    id: 'place-country',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    maxzoom: 9,
    filter: ['all', cls('country'), ['!', mergedLabel]],
    layout: {
      'text-field': name,
      'text-font': FONT.bold,
      'text-size': zoomLinear(2, 11, 6, 16),
      'text-max-width': 6,
      'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
    },
    paint: { 'text-color': c.label, ...halo, 'text-halo-width': 2 },
  });

  const sources: StyleSpecification['sources'] = {
    [SRC]: { type: 'vector', url: src.vectorTiles, attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> נתונים © <a href="https://www.openstreetmap.org/copyright" target="_blank">תורמי OpenStreetMap</a>' },
  };
  if (src.terrain) {
    sources.terrain = {
      type: 'raster-dem',
      tiles: [src.terrain],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Mapzen Terrain</a>',
    };
  }

  if (src.places) {
    sources[OVERTURE_SOURCE] = {
      type: 'vector',
      url: src.places,
      attribution: 'מקומות © <a href="https://overturemaps.org" target="_blank">Overture Maps Foundation</a>',
    };
  }
  if (mapType === 'terrain' && src.contours) {
    sources.contours = { type: 'vector', tiles: [src.contours], maxzoom: 15 };
  }
  let out = layers;
  if (satellite) {
    sources.satellite = {
      type: 'raster',
      tiles: [src.satellite!],
      tileSize: 256,
      maxzoom: 15,
      attribution: '<a href="https://s2maps.eu" target="_blank">Sentinel-2 cloudless</a> by EOX (Copernicus Sentinel data 2016)',
    };
    out = layers.filter((l) => !GROUND.has(l.id));
    out.splice(1, 0, { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-fade-duration': 150 } });
  }

  return {
    version: 8,
    name: `nadav-maps-${theme}${satellite ? '-satellite' : ''}`,
    glyphs: src.glyphs,
    // Soft, overhead light so 3D building walls read as gentle shade, not dark outlines.
    light: { anchor: 'viewport', color: '#ffffff', intensity: theme === 'dark' ? 0.25 : 0.18, position: [1.15, 210, 30] },
    sources,
    layers: out,
  };
}

type Add = (l: LayerSpecification) => void;

/**
 * Roads drawn as casing + fill pairs, minor first so major roads sit on top.
 * Widths follow Google's: highways stand out early, minor streets appear around z13.
 */
function roadLayers(add: Add, c: Palette): void {
  const roads = [
    { id: 'path', classes: ['path', 'track'], minzoom: 14, color: c.path, casing: null, w: [14, 0.6, 18, 2.2], dash: [2, 1.5] },
    { id: 'service', classes: ['service'], minzoom: 14, color: c.minorRoad, casing: c.roadCasing, w: [14, 1, 18, 7] },
    { id: 'minor', classes: ['minor'], minzoom: 12, color: c.minorRoad, casing: c.roadCasing, w: [12, 0.8, 14, 2.5, 18, 14] },
    { id: 'tertiary', classes: ['tertiary'], minzoom: 10, color: c.road, casing: c.roadCasing, w: [10, 0.8, 14, 4.5, 18, 20] },
    { id: 'secondary', classes: ['secondary'], minzoom: 8, color: c.road, casing: c.majorCasing, w: [8, 0.8, 12, 2.5, 14, 6, 18, 26] },
    { id: 'primary', classes: ['primary'], minzoom: 7, color: c.road, casing: c.majorCasing, w: [7, 0.8, 12, 3, 14, 7.5, 18, 30] },
    { id: 'trunk', classes: ['trunk'], minzoom: 5, color: c.trunk, casing: c.trunkCasing, w: [5, 0.8, 14, 7, 18, 28] },
    { id: 'motorway', classes: ['motorway'], minzoom: 4, color: c.highway, casing: c.highwayCasing, w: [4, 0.8, 14, 7, 18, 30] },
  ];
  const width = (w: number[], scale = 1) => {
    const stops: unknown[] = ['interpolate', ['exponential', 1.5], ['zoom']];
    for (let i = 0; i < w.length; i += 2) stops.push(w[i], w[i + 1] * scale);
    return stops as unknown as ExpressionSpecification;
  };
  const base = (classes: string[], extra?: ExpressionSpecification): ExpressionSpecification =>
    extra ? ['all', cls(...classes), extra] : cls(...classes);

  for (const tunnel of [true, false]) {
    const t: ExpressionSpecification = tunnel ? ['==', ['get', 'brunnel'], 'tunnel'] : notTunnel;
    const suffix = tunnel ? '-tunnel' : '';
    for (const r of roads) {
      if (r.casing) {
        add({
          id: `road-${r.id}-casing${suffix}`,
          type: 'line',
          source: SRC,
          'source-layer': 'transportation',
          minzoom: Math.max(r.minzoom, 11),
          filter: base(r.classes, t),
          layout: { 'line-cap': tunnel ? 'butt' : 'round', 'line-join': 'round' },
          paint: {
            'line-color': r.casing,
            'line-width': width(r.w, 1.35),
            'line-gap-width': 0,
            'line-opacity': tunnel ? 0.5 : 1,
            ...(tunnel ? { 'line-dasharray': [1, 0.5] } : {}),
          },
        });
      }
    }
    for (const r of roads) {
      add({
        id: `road-${r.id}${suffix}`,
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        minzoom: r.minzoom,
        filter: base(r.classes, t),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': r.color,
          'line-width': width(r.w),
          'line-opacity': tunnel ? 0.55 : 1,
          ...(r.dash ? { 'line-dasharray': r.dash } : {}),
        },
      });
    }
  }
  // Bridges get a casing over whatever runs below them.
  for (const r of roads.filter((x) => x.casing && x.minzoom <= 12)) {
    add({
      id: `road-${r.id}-bridge-casing`,
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: base(r.classes, isBridge),
      paint: { 'line-color': r.casing!, 'line-width': width(r.w, 1.5) },
    });
    add({
      id: `road-${r.id}-bridge`,
      type: 'line',
      source: SRC,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: base(r.classes, isBridge),
      layout: { 'line-join': 'round' },
      paint: { 'line-color': r.color, 'line-width': width(r.w) },
    });
  }
  // One-way arrows on streets up close.
  add({
    id: 'road-oneway',
    type: 'symbol',
    source: SRC,
    'source-layer': 'transportation',
    minzoom: 16,
    filter: ['all', ['==', ['get', 'oneway'], 1], cls('minor', 'tertiary', 'secondary', 'primary', 'service')],
    layout: { 'symbol-placement': 'line', 'icon-image': 'nm-oneway', 'symbol-spacing': 120, 'icon-rotation-alignment': 'map', 'icon-size': 0.8 },
    paint: { 'icon-opacity': 0.5 },
  });
}
