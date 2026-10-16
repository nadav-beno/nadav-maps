# Data sources: audit, risks and what to add

Checked on 2026-10-10. Each claim links the page it was verified against; anything marked
**(unverified)** could not be confirmed from the source page (blocked, JS-only or silent) and should be
re-checked before relying on it.

## תקציר לנדב

- **חדש: חיפוש, כתובות, "מה יש כאן" ופרטי מקומות בישראל מגיעים עכשיו מנתונים שלנו.** פעם בשבוע (וגם בכל פריסה, אם עבר שבוע) GitHub Actions מוריד את קובץ ה-OpenStreetMap של ישראל מ-Geofabrik, בונה ממנו קבצי חיפוש קטנים ומפרסם אותם יחד עם האתר (`data/il/`). האפליקציה קוראת אותם קודם, ורק כשאין שם תשובה טובה (מקום בחו"ל, חיפוש באותיות לטיניות, נקודה בים) פונה ל-Photon ול-Overpass כמו קודם. אין שרת, אין עלות, ואין מגבלת בקשות. מסלולים עדיין מגיעים מ-Valhalla הציבורי: ניתוב צריך שרת שמחשב, ואי אפשר לעשות אותו מקבצים סטטיים. פרטים בסעיף [Our own geodata](#our-own-geodata-self-hosted-israel).
- **הכול עובד היום בחינם ובלי מפתחות, אבל כמעט כל שירות שאנחנו משתמשים בו הוא שרת ציבורי קהילתי בלי שום התחייבות לזמינות.** לחיפוש (Photon), למסלולים (Valhalla של FOSSGIS) ולפרטי מקומות (Overpass) יש מדיניות שימוש שאוסרת במפורש עומס כבד ומפנה להקים שרת משלך. ברגע שתהיה תנועה אמיתית לאתר, אלה הדברים הראשונים שייחסמו.
- **Transitous (תחבורה ציבורית) מותר רק לפרויקט קוד פתוח ולא מסחרי.** אם Nadav Maps יהיה מסחרי (פרסומות, מנויים), צריך להחליף או להקים MOTIS משלנו על GTFS של משרד התחבורה.
- **אריחי העסקים של Overture:** Overture עצמה כותבת שלא להשתמש באריחי ה-PMTiles שלה בפרודקשן (השכבות והשדות משתנים בלי הודעה). כדאי לייצר אריחים משלנו מהנתונים (רישיון פתוח) ולשים אותם על אחסון שלנו.
- **לוויין:** אנחנו משתמשים בגרסת 2016 של Sentinel-2 cloudless, היחידה ברישיון CC BY 4.0. כל הגרסאות החדשות לא מסחריות (CC BY-NC-SA) או בתשלום ל-EOX.
- **TomTom חובר, כבוי עד שתוסיף מפתח:** שכבת "תנועה" בשכבות (צבעים כמו בגוגל, אירועים עם פרטים בהקשה), זמן נסיעה "עם תנועה" במסלולי רכב, וכלי `traffic_incidents` ב-REST וב-MCP. **הממצא החשוב: לפי התיעוד של TomTom, אין להם תנועה בזמן אמת בישראל** (ישראל לא ברשימת הכיסוי של Traffic API, ובניתוב מסומנת בלי Real-time Traffic). בארה"ב, באירופה ובמפרץ זה יעבוד. **לישראל, HERE כן מכסה תנועה ואירועים** (חינם עד 30 אלף אריחי תנועה בחודש), ולכן HERE חובר עכשיו באותו מבנה.
- **HERE חובר, כבוי עד שתוסיף מפתח:** אותה שכבת "תנועה", אותם אירועים ואותו "עם תנועה" במסלולים, מנתוני HERE. בישראל האפליקציה בוחרת HERE (גם אם יש מפתח TomTom), בארה"ב ובבריטניה TomTom כשיש את שני המפתחות, ו-HERE לבד עובד בכל מקום שהוא מכסה. הקרדיט "© HERE" מופיע רק כשהשכבה דולקת. **שים לב למכסה:** אירועי תנועה של HERE (Traffic API) חינם רק עד 5,000 בקשות בחודש; אנחנו קוראים להם רק כשמקישים על אירוע.
- **מה כדאי לעשות קודם (לפי סדר):** (1) שרת Valhalla משלנו לישראל (בערך 20 עד 40 דולר בחודש על VPS אחד; החיפוש ופרטי המקומות בישראל כבר אצלנו, ראו למעלה); (2) אריחי Overture משלנו; (3) מפתח HERE לתנועה בישראל, ומפתח TomTom לשאר העולם; (4) Open-Meteo למזג אוויר ואיכות אוויר (חינם לשימוש לא מסחרי); (5) Mapillary לתמונות רחוב (חינם עם טוקן).
- **מה אתה צריך לעשות כדי להדליק את TomTom:** פרטים בסעיף [Switching TomTom on](#switching-tomtom-on). בקצרה: חשבון ב-developer.tomtom.com, מפתח, הגבלת המפתח לדומיין שלנו, ומשתנה `VITE_TOMTOM_KEY` ב-GitHub (Settings > Secrets and variables > Actions > Variables).
- **מה אתה צריך לעשות כדי להדליק את HERE (לישראל):** פרטים בסעיף [Switching HERE on](#switching-here-on). בקצרה: חשבון ב-platform.here.com, אפליקציה עם API key, Trusted Domains עם הדומיין שלנו, ומשתנה `VITE_HERE_KEY` באותו מקום ב-GitHub.

## The sources we use today

| What | Source (default endpoint) | Env | License / attribution | Usage policy | Risk | Recommendation |
|---|---|---|---|---|---|---|
| Base map vector tiles + fonts | OpenFreeMap `tiles.openfreemap.org/planet` | `VECTOR_TILES_URL`, `GLYPHS_URL` | OpenMapTiles + © OSM contributors (ODbL); credits shown by MapLibre | Free, "no limits on the number of map views or requests", commercial use allowed, no SLA ([openfreemap.org](https://openfreemap.org/)) | Low-medium: one volunteer-run service, donation funded, no SLA | **Keep.** Plan B: self-host OpenFreeMap / Planetiler tiles (~€20–40/month VPS + CDN) |
| Search, addresses, reverse geocode, place details, label identify **in Israel** (new) | **Our own static files** `<site>/data/il/`, built weekly in CI from the Geofabrik extract `download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf` | `GEODATA_URL` (web default: the site's own `data/`; server default off) | © OSM contributors (ODbL), extract by Geofabrik | Ours: no rate limit. Geofabrik's free downloads: we fetch one file once a week | Low: if a weekly build fails, the last good build is deployed again; if the files are missing the app uses Photon/Overpass | **Keep.** See [Our own geodata](#our-own-geodata-self-hosted-israel) |
| Search, reverse geocode (outside Israel, and the fallback) | Photon by komoot `photon.komoot.io` | `PHOTON_URL` | © OSM (ODbL) | "reasonable limit… Extensive usage will be throttled or completely banned… consider setting up your own private instance… no guarantees for availability" ([Photon README](https://raw.githubusercontent.com/komoot/photon/master/README.md)) | Medium now (Israel traffic mostly answered locally), **high** for a worldwide launch | Add more regions to our own geodata; self-host Photon only for worldwide coverage (planet needs ~64+ GB RAM) |
| Car / walk / bike routing | Valhalla on FOSSGIS `valhalla1.openstreetmap.de` | `VALHALLA_URL` | © OSM (ODbL) | FOSSGIS routing servers: "One request per second max. No scraping, no heavy usage. Use a valid user agent" ([routing.openstreetmap.de/about](https://routing.openstreetmap.de/about.html)); the full FOSSGIS terms page is behind bot protection, so applying it to the Valhalla instance is **(unverified)** | **High**: 1 req/s for the whole app is far below real traffic (every route = 1 + up to 3 more for the mode tabs) | **Self-host Valhalla** (Israel tiles build in minutes; ~$20–40/month VM, can share the Photon box) |
| Nearby by category; place details and identify outside Israel (and the fallback) | Overpass API `overpass-api.de` | `OVERPASS_URL` | © OSM (ODbL) | "maximum of about 10000 requests per day… download volume below about 1 GB per day"; heavier use should run its own instance ([Overpass manual](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)) | **High**: 10K/day across *all* our users | **Self-host Overpass** for Israel, or move details to our own POI database (OSM + Overture + Foursquare OS Places) |
| Businesses (Overture places) | Overture PMTiles on S3 `overturemaps-extras-us-west-2…/tiles/{release}/places.pmtiles` | `PLACES_URL` | Meta and Microsoft data CDLA Permissive 2.0, Foursquare data Apache 2.0 ([Overture attribution](https://docs.overturemaps.org/attribution/)) | Overture "warns against using these tiles in production": layers, properties and zooms may change in any release ([cloud sources](https://docs.overturemaps.org/getting-data/cloud-sources/)). Releases are archived, retention not stated | Medium: schema changes break our style; old releases vanish (we already resolve `{release}` daily) | **Build our own PMTiles** from the GeoParquet each month (one job, store on R2/S3, a few $/month) |
| Satellite imagery | EOX Sentinel-2 cloudless **2016** `tiles.maps.eox.at` | `SATELLITE_URL` | 2016 edition: CC BY 4.0; 2018 and later: CC BY-NC-SA 4.0 ([EOX 2018 release note](https://eox.at/2019/02/sentinel-2-cloudless-2018/)); commercial use of newer editions needs an EOX commercial licence ([EOX licence](https://cloudless.eox.at/documentation/license)) | No published rate limit for the tile service **(unverified)** | Medium: 10 m/pixel and 2016; EOX may restrict the free WMTS | **Keep 2016** (don't switch the year without a licence). For detailed imagery: a paid provider (e.g. Esri, Maxar, MapTiler) |
| Hillshade, contours, elevation profile | Mapzen Terrain Tiles on AWS Open Data `s3.amazonaws.com/elevation-tiles-prod` | `TERRAIN_URL` | Per-source credits (SRTM/USGS public domain, EU-DEM, etc.), plus "Mapzen" ([attribution.md](https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md)); no AWS account needed ([registry](https://registry.opendata.aws/terrain-tiles/)) | No usage policy published; AWS Open Data sponsorship | Low: static, sponsored dataset (not updated, but terrain doesn't move) | **Keep.** Our credit says "Mapzen Terrain" and links the list, which matches the attribution doc |
| Public transport | Transitous (MOTIS) `api.transitous.org` | `TRANSIT_URL` | Must "link to transitous.org/sources in a visible place" + OSM attribution ([API terms](https://transitous.org/api/)) | Only for projects that are **open source and not commercial**; "commercial use is not allowed"; contact them before resource-intensive endpoints; send a User-Agent with contact ([API terms](https://transitous.org/api/)) | **High if we go commercial**, medium otherwise (volunteer service) | **Keep while non-commercial** (we now link the sources page in About). Before any monetisation: self-host MOTIS with Israel GTFS (~$20–40/month) |
| Place descriptions and photos | Wikipedia REST + Wikidata | (fixed) | CC BY-SA, link back | Be considerate, requests in series, descriptive User-Agent ([API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)) | Low | **Keep** |
| Live traffic, incidents, traffic-aware car times (new, off) | TomTom `api.tomtom.com` | `TOMTOM_KEY` | "© TomTom" (we show it in the map credits and About only while it's on) | Free tier per month: 200K traffic vector tiles, 2.5K Incident Details, 20K Routing ([pricing](https://docs.tomtom.com/pricing)); commercial use allowed "even as part of the free evaluation" ([FAQ](https://docs.tomtom.com/platform/documentation/status-and-support/faqs)) | **No live traffic in Israel** (see below); browser key is public by nature | **Key-based, wired, off.** Use for the US/Europe/Gulf; HERE for Israel |
| Live traffic, incidents, traffic-aware car times (new, off) | HERE `traffic.vector.hereapi.com`, `data.traffic.hereapi.com`, `router.hereapi.com` | `HERE_KEY` | "© <year> HERE" (map credits and About, only while it's on) | Free per month: 30K Traffic Vector Tile, 5K Traffic (v7 incidents), 30K Routing car ([HERE plans](https://developers.here.com/plans)) | Low-medium: 5K incident calls/month is small; browser key is public (limit it with Trusted Domains) | **Key-based, wired, off.** The provider for Israel |

Things that are already done right: provider URLs are all env driven, `''` switches a source off, the
User-Agent identifies us, our own server logs never carry coordinates or search text, and error
reports strip the URL query and hash. Note that every third-party provider above (and TomTom when on)
does receive the coordinates or search text it needs to answer; that is unavoidable without self-hosting.

## Our own geodata (self-hosted, Israel)

Search, addresses, reverse geocoding, place details and "which OSM object is this label" for Israel
no longer need a public server. They are answered from static JSON files we build ourselves from raw
OpenStreetMap and publish with the site on GitHub Pages.

- **Pipeline** (`scripts/geodata/`, run by `.github/workflows/deploy.yml`): `build-all.sh` downloads the
  extract named in `packages/core/src/region.ts` (`geodata.extract`, today Geofabrik's
  `israel-and-palestine-latest.osm.pbf`, © OpenStreetMap contributors, ODbL), keeps named objects,
  addresses, places and municipal boundaries (`osmium tags-filter`), exports them as GeoJSONSeq with each
  object's OSM type and id (`osmium export -a type,id`), and streams that through `build.ts`.
  The output is copied to `apps/web/dist/data/<region>/` before the Pages upload.
- **Refresh**: weekly. The output is cached with `actions/cache`, keyed by ISO week and a hash of the
  builder, so normal deploys reuse it; a Monday 03:17 UTC `schedule` run rebuilds it. If the download or
  the build fails, the deploy continues with the newest older cache (restore-keys), and with none at all
  the app simply uses Photon/Overpass.
- **Formats** (`packages/core/src/geoindex.ts`, version 1): `manifest.json`; `names.json` (unique names
  with kind, weight and city, top 150,000 by weight, for spell correction); `places.json` (settlements and
  neighbourhoods); search shards `s/<prefix>.json` (each record is stored under the first 2 letters of
  every word of every name, prefixes that get too big are split to 3+ letters, so a query reads 1–2 files
  of at most ~300 KB); `a/<n>.json` housenumbers per street (by hash); `d/<n>.json` OSM tags per object
  (by hash of the id); `r/<x>_<y>.json` a 0.02° reverse-geocoding grid with addresses, simplified street
  lines and POIs. Keys go through `searchKey()` (our Hebrew normalisation plus final letters).
- **Expected size for Israel** (estimated from a synthetic Israel-sized input: 1,200 settlements, 114K
  named street ways, 555K addresses, 118K named POIs, 208 MB of GeoJSONSeq): ~120 MB on disk in ~4,600
  files, ~30 MB gzipped (Pages serves JSON gzipped); `names.json` 8.5 MB raw / 1.5 MB gzipped; the
  largest single file ~300 KB. Build time ~1 minute plus download and osmium; peak memory ~0.6 GB (the
  workflow allows 6 GB). The real extract has more streets and tags, so expect up to ~2x. The build fails
  (and the old data stays) if any file would exceed 20 MB.
- **How the app uses it** (`packages/tools/src/providers/localgeo.ts`): `search_places` asks our data
  first when the map centre (or the default region) has `geodata`; a Hebrew/Arabic query with a complete
  match, or a resolved "street number" address, is answered without Photon. Latin-script queries (often
  foreign places) and misses also ask Photon, with our settlements and exact matches kept on top.
  `reverse_geocode` (address within 35 m, POI within 20 m, street within 70 m, else the settlement),
  `place_details` and `identify_place` read our files first and fall back to Photon/Overpass on a miss or
  an error. The same provider works in the REST/MCP server with `GEODATA_URL=https://nadav-beno.github.io/nadav-maps/data/`.
- **Limits**: data is up to a week old; other countries still use Photon (add a `geodata` entry in
  `region.ts` with a Geofabrik extract to cover one); ranking is simpler than Photon's (word/prefix
  matches, kind and population weight, distance to the map centre); "nearby by category" still uses
  Overpass. **Routing stays on public Valhalla**: a route is a graph search over the whole road network
  that depends on both end points, so it cannot be precomputed into static files; it needs a running
  router (Valhalla, OSRM or GraphHopper) on a server of our own (~$20–40/month for Israel).
- **Privacy**: shard and grid file names reveal the first letters of a query and a ~2 km cell to the
  static host (GitHub Pages), never the full text or the exact point, and we keep no logs of our own;
  this is less than Photon receives.
- **Geofabrik**: free downloads of OSM extracts, updated daily; please don't hammer the server (our use
  is one file a week). Their exact fair-use wording was not re-checked here **(unverified)**.

## TomTom: what we verified

- **Coverage. Israel has no TomTom live traffic.** The Traffic API market coverage lists ~73 markets and
  says "If a market is missing in the following tables, it is not currently supported"; Israel is not
  listed, while the US, UK, most of Europe, Egypt, Türkiye and the Gulf states are
  ([Orbis traffic coverage](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/product-information/market-coverage),
  [v1 traffic coverage](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/market-coverage)).
  The Routing API lists Israel for Calculate Route but **without** "Real-time Traffic"
  ([routing coverage](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/product-information/market-coverage)).
  The app copes: the region entry for Israel lists only HERE under `coverage.traffic`, so
  `trafficProvider()` picks HERE there when its key exists. With only a TomTom key, the layers screen
  says TomTom has no live data in Israel and the directions screen shows "עם תנועה" there only if
  TomTom reports a real delay (≥ 1 minute).
- **Endpoints we use** (v4 "Genesis", GA; TomTom recommends Orbis for new work, and the Orbis raster
  flow tiles currently document only `light`/`dark` styles): vector flow tiles
  ([doc](https://docs.tomtom.com/traffic-api/documentation/traffic-flow/vector-flow-tiles)), vector
  incident tiles with descriptions in `he-IL` ([doc](https://docs.tomtom.com/traffic-api/documentation/traffic-incidents/vector-incident-tiles)),
  Incident Details v5 (bbox ≤ 10,000 km², `he-IL` supported, [doc](https://docs.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details)),
  Calculate Route with `traffic=true` and `supportingPoints` so TomTom times **our** Valhalla line
  ([doc](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route)).
- **Free tier vs our usage** ([pricing](https://docs.tomtom.com/pricing)): 200K traffic vector tile
  requests/month (we request flow + incidents tiles only while the layer is on, zoom ≥ 6, overzoomed
  after z18); 2.5K Incident Details/month (we call it only when someone taps an incident, or via the
  `traffic_incidents` tool); 20K Routing/month (one call per car route the user looks at). A few hundred
  daily users would exceed the tile allowance; pay-as-you-go prices are not on the pricing page
  **(unverified)**.
- **Key protection**: TomTom keys can be limited to a list of domains (wildcards allowed) and to chosen
  products, and have a default rate limit ([key management](https://docs.tomtom.com/platform/documentation/api-best-practices/api-key-management-best-practices)).
- **Showing TomTom traffic on a non-TomTom base map, and caching**: the developer Terms and Conditions
  page ([docs.tomtom.com/legal/terms-and-conditions](https://docs.tomtom.com/legal/terms-and-conditions/))
  renders only with JavaScript and could not be read here, so **both points are unverified**. TomTom's
  own docs show the traffic tiles as overlays and the FAQ allows commercial apps on the free tier, but
  before launch read the T&C sections on "Content", storage/caching and attribution. Until then we do
  not cache TomTom responses beyond the browser's normal HTTP cache and the tool client's 5-minute
  in-memory cache, and we show "© TomTom" whenever the layer is on.

## HERE: what we verified

- **Coverage.** Israel is listed with Flow ✅ and Incidents ✅ (code E0435); the UK and every US row too
  ([HERE Traffic API v7 coverage](https://docs.here.com/traffic-api/docs/traffic-here-traffic-api-v7-coverage-information)).
- **Which provider where** (`trafficProvider(region, keys)` in `packages/core/src/region.ts`, unit tested):
  each region lists the providers with live traffic, best first (Israel `['here']`, US/UK
  `['tomtom', 'here']`). The first listed one with a key wins; else any configured key (TomTom first),
  marked not live. The map layer follows the region on screen; the tools pick by the box centre / route start.
- **Endpoints we use** (all with `apiKey=`):
  - Flow + incidents on the map: Traffic Vector Tile API v2,
    `https://traffic.vector.hereapi.com/v2/traffictiles/traffic/mc/{z}/{x}/{y}/omv`, zoom 0 to 17, layers
    `traffic_flow` (`kind` free/minor/slow/queuing/stationary, `drives_on_left`), `traffic_incidents`
    (`road_closed`), `incident_icons` (`kind`, `warning_level`, `is_primary`)
    ([get started](https://docs.here.com/traffic-api/docs/get-started-with-traffic-vector-tile),
    [layers](https://docs.here.com/traffic-api/docs/traffic-vector-tile-layers)). We draw it ourselves in the
    same Google-like colours as TomTom, under our labels and route lines, re-added after every style swap,
    slightly translucent in dark mode. The raster alternative, Traffic Raster Tile API v3
    `https://traffic.maps.hereapi.com/v3/flow/mc/{z}/{x}/{y}/png?style=explore.day` (HERE's own colours,
    [reference](https://docs.here.com/traffic-api/reference/here-traffic-raster-tile-api-v3-gettile)), is not used.
  - Incident details: Traffic API v7 `https://data.traffic.hereapi.com/v7/incidents?in=bbox:w,s,e,n&locationReferencing=shape&lang=he-IL`;
    the box may be at most 1° wide and 1° tall ([geospatial filters](https://docs.here.com/traffic-api/docs/geospatial-filters-here-traffic-api-v7-concepts),
    [reference](https://docs.here.com/traffic-api/reference/traffic-api-v7-getincidents)). v7 has no delay
    in seconds, so HERE incidents show severity (criticality) instead.
  - Traffic-aware car time: Routing v8 `https://router.hereapi.com/v8/routes?transportMode=car&origin=…&destination=…&via=lat,lng!passThrough=true…&departureTime=<now>&return=summary,typicalDuration`
    ([reference](https://docs.here.com/routing/reference/routing-api-v8-calculateroutes)). Up to 30
    pass-through points from our Valhalla line (plus each stop) make HERE time *our* route; we read
    `duration` and `baseDuration` (free flow).
- **Free tier vs our usage** ([HERE Base plan](https://developers.here.com/plans)): Traffic Vector Tile
  30K/month then $0.113 per 1,000; Traffic (v7 incidents) 5K/month then $2.75 per 1,000 (called only when
  someone taps an incident or uses `traffic_incidents`); Routing car 30K/month then $0.83 per 1,000 (one
  call per car route looked at). Whether a `departureTime` route counts as plain "Car" or as the pricier
  "Time Aware" routing line on that page is **(unverified)**. The page does not say a card is needed for
  the Base plan **(unverified)**; without payment details the Limited plan's requests-per-second caps apply.
- **Key protection**: Trusted Domains on the app's credentials (up to 20 in the web UI); requests from other
  sites "may be rejected" ([HERE KB](https://docs.here.com/here-kb/docs/trusted-domains-for-api-keys-allow-only-approved-websites-to-use-your-credentials)).
  How server calls without a Referer are treated is **(unverified)**, so give the REST/MCP server its own
  key without domain limits.
- **HERE data on a non-HERE base map, and caching**: not checked against HERE's service terms
  **(unverified)**; until then no caching beyond the browser's HTTP cache and the tool client's 5-minute
  in-memory cache, and "© HERE" whenever the layer is on.

## Gaps vs Google Maps, and what would close them

| Gap | Best source | Terms / cost (verified where linked) | Notes |
|---|---|---|---|
| Live traffic and incidents, **Israel** | HERE Traffic API / Traffic Vector Tiles | Israel listed with flow and incidents ([HERE coverage](https://docs.here.com/traffic-api/docs/here-traffic-api-v7-coverage-information)); free 30K traffic tiles/month then $0.113 per 1,000, Traffic API 5K free then $2.75 per 1,000 ([HERE plans](https://developers.here.com/plans)) | **Wired** (`HERE_KEY`, off until set), see above. HERE terms on non-HERE base maps **(unverified)** |
| Live traffic and incidents, rest of world | TomTom (wired) | See above | Covers US, UK, EU, Gulf |
| Traffic-aware ETAs | TomTom Routing (wired, 20K/month free), HERE Routing (30K/month free) | [TomTom pricing](https://docs.tomtom.com/pricing), [HERE plans](https://developers.here.com/plans) | Valhalla stays the route source; the provider only times it |
| Business hours, photos, reviews | OSM + Overture (no reviews), **Foursquare OS Places** (open, Apache 2.0, also a PMTiles file; [access](https://docs.foursquare.com/data-products/docs/access-fsq-os-places)); TomTom Places (Details 5K/month free, [pricing](https://docs.tomtom.com/pricing)) | | Reviews and user photos are the one thing no open dataset has; they need our own accounts + moderation, or a paid provider |
| Street-level imagery | Mapillary | Client token from the developer dashboard; tiles 50,000/day per app ([API docs](https://www.mapillary.com/developer/api-documentation)); imagery licence CC BY-SA **(unverified on that page)** | Coverage tiles + a viewer in the place card |
| Speed cameras, road alerts (Israel) | OSM `highway=speed_camera` and `enforcement` relations via our own Overpass / extract | ODbL | Tag docs page did not load **(unverified)**; legality of showing cameras differs by country (allowed in Israel **(unverified)**) |
| Weather | Open-Meteo | Free API only for non-commercial use, < 10,000 calls/day, 5,000/hour, 600/minute, data CC BY 4.0 ([terms](https://open-meteo.com/en/terms)) | Commercial use needs a paid plan |
| Air quality | Open-Meteo Air Quality API (same terms); Israel's Ministry of Environmental Protection monitoring network **(no public API found)** | | |
| Transit real time (Israel) | MoT SIRI web service | Documented in Hebrew on gov.il ([open-bus wiki](https://github.com/hasadna/open-bus/wiki/Bus-Real-Time-(SIRI)-Data-Documentation)); registration and a whitelisted static IP are required **(unverified)** | Needs our own server; then publish as GTFS-RT into our own MOTIS. Whether Transitous already ingests Israeli realtime: **(unverified)** |

## Switching TomTom on

1. Create an account at [developer.tomtom.com](https://developer.tomtom.com/) and create an API key
   (the free tier needs no card **(unverified)**).
2. In the key's settings, enable only the products we use: **Traffic API** (flow, incidents) and
   **Routing API**. Add the domain whitelist: `nadav-beno.github.io` (and `localhost` if you want to try it locally).
3. In GitHub: repository **Settings > Secrets and variables > Actions > Variables > New repository
   variable**, name `VITE_TOMTOM_KEY`, value = the key. (A variable is fine: the key ends up in the
   public JavaScript anyway, which is why step 2 matters.) For the REST/MCP server set `TOMTOM_KEY`
   in its environment.
4. Re-run the "Deploy to GitHub Pages" workflow (or push to main). The "תנועה" button appears under
   שכבות; nothing changes for anyone while the variable is empty.
5. Watch usage in the TomTom dashboard for the first weeks; remember Israel shows no live flow (see above).

To try a key locally without a build: `pnpm dev` and open `http://localhost:5173/?tomtom=<key>`
(the `?tomtom=` override is ignored on any host except localhost).

## Switching HERE on

1. Create an account at [platform.here.com](https://platform.here.com/) (Base plan). Under
   **Access Manager > Apps**, register an app and create an **API key** for it.
2. On the same app, open **Trusted Domains** and add `nadav-beno.github.io` (and `localhost` to try it
   locally). The key ends up in the public JavaScript, so this is what stops others from using it.
3. In GitHub: repository **Settings > Secrets and variables > Actions > Variables > New repository
   variable**, name `VITE_HERE_KEY`, value = the key. For the REST/MCP server set `HERE_KEY` in its
   environment (use a second key without Trusted Domains there).
4. Re-run the "Deploy to GitHub Pages" workflow (or push to main). The "תנועה" button appears under
   שכבות; in Israel it shows HERE traffic, and car routes there show "עם תנועה".
5. Watch usage in the HERE platform for the first weeks, mainly the 5K/month Traffic (incidents) line.

To try a key locally without a build: `pnpm dev` and open `http://localhost:5173/?here=<key>`
(ignored on any host except localhost).
