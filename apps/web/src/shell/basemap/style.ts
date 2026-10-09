import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import { OVERTURE_SOURCE, PROMINENT_GROUPS } from '@nm/core';
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
  shieldText: string;
  hillShadow: string;
  hillHighlight: string;
}

export const LIGHT: Palette = {
  land: '#f1efea',
  water: '#9fcff5',
  waterLabel: '#3a74a8',
  park: '#cbe8c3',
  wood: '#c3e1b4',
  grass: '#d8edcf',
  sand: '#f4ead2',
  ice: '#f2f8fb',
  residential: '#efede8',
  commercial: '#f6eee4',
  industrial: '#eceae6',
  hospital: '#f9e3e1',
  school: '#f3ecdc',
  cemetery: '#d9e7d3',
  airport: '#e9e8ef',
  building: '#e3dfd8',
  buildingTop: '#ebe8e2',
  buildingLine: '#d6d0c6',
  road: '#ffffff',
  roadCasing: '#d2ccc1',
  minorRoad: '#ffffff',
  path: '#c9c2b5',
  highway: '#f7cf6a',
  highwayCasing: '#dda94b',
  trunk: '#fbe39e',
  trunkCasing: '#e2c070',
  rail: '#b4b0aa',
  boundary: '#9c8fb0',
  label: '#2e3237',
  labelMuted: '#6c7178',
  roadLabel: '#4f545a',
  halo: '#ffffff',
  shield: '#ffffff',
  shieldText: '#33373c',
  hillShadow: 'rgba(84, 70, 52, 0.20)',
  hillHighlight: 'rgba(255, 255, 255, 0.18)',
};

export const DARK: Palette = {
  land: '#1d2126',
  water: '#16314d',
  waterLabel: '#7fa9d1',
  park: '#1f3326',
  wood: '#1d3122',
  grass: '#22342a',
  sand: '#2c2a23',
  ice: '#2a3036',
  residential: '#21252b',
  commercial: '#262429',
  industrial: '#23262b',
  hospital: '#2e2426',
  school: '#2a2824',
  cemetery: '#21302a',
  airport: '#25262e',
  building: '#2b3037',
  buildingTop: '#323840',
  buildingLine: '#383e46',
  road: '#3b4149',
  roadCasing: '#2a2e34',
  minorRoad: '#353a41',
  path: '#4a4f57',
  highway: '#8a6d34',
  highwayCasing: '#5e4a26',
  trunk: '#6b5a35',
  trunkCasing: '#4a3f27',
  rail: '#555a62',
  boundary: '#8a7fa3',
  label: '#d9dde2',
  labelMuted: '#9aa1aa',
  roadLabel: '#b9bfc7',
  halo: '#1d2126',
  shield: '#3b4149',
  shieldText: '#e6e9ed',
  hillShadow: 'rgba(0, 0, 0, 0.35)',
  hillHighlight: 'rgba(255, 255, 255, 0.04)',
};

const SRC = 'omt';

/** Label text in the UI language when OSM has it, otherwise the local name. */
export function nameExpr(lang: string): ExpressionSpecification {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']];
}

const zoomLinear = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification;
const zoomExp = (...stops: number[]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as unknown as ExpressionSpecification;

const cls = (...values: string[]): ExpressionSpecification => ['match', ['get', 'class'], values, true, false];
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
      'line-color': theme === 'dark' ? '#3a3d48' : '#d9d8e2',
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
    filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1]],
    paint: { 'line-color': c.boundary, 'line-opacity': 0.5, 'line-width': zoomLinear(4, 0.6, 12, 1.4), 'line-dasharray': [3, 2] },
  });
  add({
    id: 'boundary-country',
    type: 'line',
    source: SRC,
    'source-layer': 'boundary',
    filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
    paint: {
      'line-color': c.boundary,
      'line-width': zoomLinear(1, 0.8, 6, 1.4, 12, 2.4),
      'line-dasharray': ['case', ['==', ['get', 'disputed'], 1], ['literal', [2, 2]], ['literal', [1, 0]]] as unknown as number[],
    },
  });

  // --- labels (bottom to top: water, roads, POIs, places) ---
  const halo = { 'text-halo-color': c.halo, 'text-halo-width': 1.4, 'text-halo-blur': 0.3 };

  add({
    id: 'waterway-label',
    type: 'symbol',
    source: SRC,
    'source-layer': 'waterway',
    minzoom: 12,
    filter: cls('river', 'canal', 'stream'),
    layout: { 'text-field': name, 'text-font': FONT.italic, 'text-size': 12, 'symbol-placement': 'line', 'text-letter-spacing': 0.05 },
    paint: { 'text-color': c.waterLabel, ...halo },
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
    paint: { 'text-color': c.waterLabel, ...halo },
  });
  add({
    id: 'water-label-line',
    type: 'symbol',
    source: SRC,
    'source-layer': 'water_name',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'text-field': name, 'text-font': FONT.italic, 'text-size': 13, 'symbol-placement': 'line' },
    paint: { 'text-color': c.waterLabel, ...halo },
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
    paint: { 'text-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#3b2a00', c.shieldText] },
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
    paint: { 'text-color': theme === 'dark' ? '#c9b393' : '#7a5a34', ...halo },
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
    filter: cls('state', 'province'),
    layout: { 'text-field': name, 'text-font': FONT.regular, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 8 },
    paint: { 'text-color': c.labelMuted, ...halo },
  });
  add({
    id: 'place-country',
    type: 'symbol',
    source: SRC,
    'source-layer': 'place',
    maxzoom: 9,
    filter: cls('country'),
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
    { id: 'secondary', classes: ['secondary'], minzoom: 8, color: c.road, casing: c.roadCasing, w: [8, 0.8, 12, 2.5, 14, 6, 18, 26] },
    { id: 'primary', classes: ['primary'], minzoom: 7, color: c.road, casing: c.roadCasing, w: [7, 0.8, 12, 3, 14, 7.5, 18, 30] },
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
