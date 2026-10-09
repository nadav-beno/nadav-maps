import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

// MapLibre 6 ships its web worker as a separate file; let Vite serve it.
maplibregl.setWorkerUrl(workerUrl);

// Free OpenStreetMap vector tiles, no API key needed.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URL,
  center: [34.8, 31.5],
  zoom: 7,
});

map.addControl(new maplibregl.NavigationControl(), 'top-left');
