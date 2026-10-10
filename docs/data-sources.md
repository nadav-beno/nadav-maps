# Data sources: audit, risks and what to add

Checked on 2026-10-10. Each claim links the page it was verified against; anything marked
**(unverified)** could not be confirmed from the source page (blocked, JS-only or silent) and should be
re-checked before relying on it.

## תקציר לנדב

- **הכול עובד היום בחינם ובלי מפתחות, אבל כמעט כל שירות שאנחנו משתמשים בו הוא שרת ציבורי קהילתי בלי שום התחייבות לזמינות.** לחיפוש (Photon), למסלולים (Valhalla של FOSSGIS) ולפרטי מקומות (Overpass) יש מדיניות שימוש שאוסרת במפורש עומס כבד ומפנה להקים שרת משלך. ברגע שתהיה תנועה אמיתית לאתר, אלה הדברים הראשונים שייחסמו.
- **Transitous (תחבורה ציבורית) מותר רק לפרויקט קוד פתוח ולא מסחרי.** אם Nadav Maps יהיה מסחרי (פרסומות, מנויים), צריך להחליף או להקים MOTIS משלנו על GTFS של משרד התחבורה.
- **אריחי העסקים של Overture:** Overture עצמה כותבת שלא להשתמש באריחי ה-PMTiles שלה בפרודקשן (השכבות והשדות משתנים בלי הודעה). כדאי לייצר אריחים משלנו מהנתונים (רישיון פתוח) ולשים אותם על אחסון שלנו.
- **לוויין:** אנחנו משתמשים בגרסת 2016 של Sentinel-2 cloudless, היחידה ברישיון CC BY 4.0. כל הגרסאות החדשות לא מסחריות (CC BY-NC-SA) או בתשלום ל-EOX.
- **TomTom חובר, כבוי עד שתוסיף מפתח:** שכבת "תנועה" בשכבות (צבעים כמו בגוגל, אירועים עם פרטים בהקשה), זמן נסיעה "עם תנועה" במסלולי רכב, וכלי `traffic_incidents` ב-REST וב-MCP. **הממצא החשוב: לפי התיעוד של TomTom, אין להם תנועה בזמן אמת בישראל** (ישראל לא ברשימת הכיסוי של Traffic API, ובניתוב מסומנת בלי Real-time Traffic). בארה"ב, באירופה ובמפרץ זה יעבוד. **לישראל, HERE כן מכסה תנועה ואירועים** (חינם עד 30 אלף אריחי תנועה בחודש), ולכן ההמלצה היא להוסיף את HERE כספק תנועה לישראל באותו מבנה.
- **מה כדאי לעשות קודם (לפי סדר):** (1) שרת Photon + Valhalla משלנו לישראל (בערך 20 עד 40 דולר בחודש על VPS אחד); (2) אריחי Overture משלנו; (3) מפתח HERE לתנועה בישראל, ומפתח TomTom לשאר העולם; (4) Open-Meteo למזג אוויר ואיכות אוויר (חינם לשימוש לא מסחרי); (5) Mapillary לתמונות רחוב (חינם עם טוקן).
- **מה אתה צריך לעשות כדי להדליק את TomTom:** פרטים בסעיף [Switching TomTom on](#switching-tomtom-on). בקצרה: חשבון ב-developer.tomtom.com, מפתח, הגבלת המפתח לדומיין שלנו, ומשתנה `VITE_TOMTOM_KEY` ב-GitHub (Settings > Secrets and variables > Actions > Variables).

## The sources we use today

| What | Source (default endpoint) | Env | License / attribution | Usage policy | Risk | Recommendation |
|---|---|---|---|---|---|---|
| Base map vector tiles + fonts | OpenFreeMap `tiles.openfreemap.org/planet` | `VECTOR_TILES_URL`, `GLYPHS_URL` | OpenMapTiles + © OSM contributors (ODbL); credits shown by MapLibre | Free, "no limits on the number of map views or requests", commercial use allowed, no SLA ([openfreemap.org](https://openfreemap.org/)) | Low-medium: one volunteer-run service, donation funded, no SLA | **Keep.** Plan B: self-host OpenFreeMap / Planetiler tiles (~€20–40/month VPS + CDN) |
| Search, reverse geocode | Photon by komoot `photon.komoot.io` | `PHOTON_URL` | © OSM (ODbL) | "reasonable limit… Extensive usage will be throttled or completely banned… consider setting up your own private instance… no guarantees for availability" ([Photon README](https://raw.githubusercontent.com/komoot/photon/master/README.md)) | **High** for a public launch | **Self-host** (Israel extract: small VM, ~4–8 GB RAM, ~$20/month; planet needs ~64+ GB RAM) |
| Car / walk / bike routing | Valhalla on FOSSGIS `valhalla1.openstreetmap.de` | `VALHALLA_URL` | © OSM (ODbL) | FOSSGIS routing servers: "One request per second max. No scraping, no heavy usage. Use a valid user agent" ([routing.openstreetmap.de/about](https://routing.openstreetmap.de/about.html)); the full FOSSGIS terms page is behind bot protection, so applying it to the Valhalla instance is **(unverified)** | **High**: 1 req/s for the whole app is far below real traffic (every route = 1 + up to 3 more for the mode tabs) | **Self-host Valhalla** (Israel tiles build in minutes; ~$20–40/month VM, can share the Photon box) |
| Place details, nearby by category, identify | Overpass API `overpass-api.de` | `OVERPASS_URL` | © OSM (ODbL) | "maximum of about 10000 requests per day… download volume below about 1 GB per day"; heavier use should run its own instance ([Overpass manual](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)) | **High**: 10K/day across *all* our users | **Self-host Overpass** for Israel, or move details to our own POI database (OSM + Overture + Foursquare OS Places) |
| Businesses (Overture places) | Overture PMTiles on S3 `overturemaps-extras-us-west-2…/tiles/{release}/places.pmtiles` | `PLACES_URL` | Meta and Microsoft data CDLA Permissive 2.0, Foursquare data Apache 2.0 ([Overture attribution](https://docs.overturemaps.org/attribution/)) | Overture "warns against using these tiles in production": layers, properties and zooms may change in any release ([cloud sources](https://docs.overturemaps.org/getting-data/cloud-sources/)). Releases are archived, retention not stated | Medium: schema changes break our style; old releases vanish (we already resolve `{release}` daily) | **Build our own PMTiles** from the GeoParquet each month (one job, store on R2/S3, a few $/month) |
| Satellite imagery | EOX Sentinel-2 cloudless **2016** `tiles.maps.eox.at` | `SATELLITE_URL` | 2016 edition: CC BY 4.0; 2018 and later: CC BY-NC-SA 4.0 ([EOX 2018 release note](https://eox.at/2019/02/sentinel-2-cloudless-2018/)); commercial use of newer editions needs an EOX commercial licence ([EOX licence](https://cloudless.eox.at/documentation/license)) | No published rate limit for the tile service **(unverified)** | Medium: 10 m/pixel and 2016; EOX may restrict the free WMTS | **Keep 2016** (don't switch the year without a licence). For detailed imagery: a paid provider (e.g. Esri, Maxar, MapTiler) |
| Hillshade, contours, elevation profile | Mapzen Terrain Tiles on AWS Open Data `s3.amazonaws.com/elevation-tiles-prod` | `TERRAIN_URL` | Per-source credits (SRTM/USGS public domain, EU-DEM, etc.), plus "Mapzen" ([attribution.md](https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md)); no AWS account needed ([registry](https://registry.opendata.aws/terrain-tiles/)) | No usage policy published; AWS Open Data sponsorship | Low: static, sponsored dataset (not updated, but terrain doesn't move) | **Keep.** Our credit says "Mapzen Terrain" and links the list, which matches the attribution doc |
| Public transport | Transitous (MOTIS) `api.transitous.org` | `TRANSIT_URL` | Must "link to transitous.org/sources in a visible place" + OSM attribution ([API terms](https://transitous.org/api/)) | Only for projects that are **open source and not commercial**; "commercial use is not allowed"; contact them before resource-intensive endpoints; send a User-Agent with contact ([API terms](https://transitous.org/api/)) | **High if we go commercial**, medium otherwise (volunteer service) | **Keep while non-commercial** (we now link the sources page in About). Before any monetisation: self-host MOTIS with Israel GTFS (~$20–40/month) |
| Place descriptions and photos | Wikipedia REST + Wikidata | (fixed) | CC BY-SA, link back | Be considerate, requests in series, descriptive User-Agent ([API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)) | Low | **Keep** |
| Live traffic, incidents, traffic-aware car times (new, off) | TomTom `api.tomtom.com` | `TOMTOM_KEY` | "© TomTom" (we show it in the map credits and About only while it's on) | Free tier per month: 200K traffic vector tiles, 2.5K Incident Details, 20K Routing ([pricing](https://docs.tomtom.com/pricing)); commercial use allowed "even as part of the free evaluation" ([FAQ](https://docs.tomtom.com/platform/documentation/status-and-support/faqs)) | **No live traffic in Israel** (see below); browser key is public by nature | **Key-based, wired, off.** Use for the US/Europe/Gulf; add HERE for Israel |

Things that are already done right: provider URLs are all env driven, `''` switches a source off, the
User-Agent identifies us, our own server logs never carry coordinates or search text, and error
reports strip the URL query and hash. Note that every third-party provider above (and TomTom when on)
does receive the coordinates or search text it needs to answer; that is unavoidable without self-hosting.

## TomTom: what we verified

- **Coverage. Israel has no TomTom live traffic.** The Traffic API market coverage lists ~73 markets and
  says "If a market is missing in the following tables, it is not currently supported"; Israel is not
  listed, while the US, UK, most of Europe, Egypt, Türkiye and the Gulf states are
  ([Orbis traffic coverage](https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/product-information/market-coverage),
  [v1 traffic coverage](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/market-coverage)).
  The Routing API lists Israel for Calculate Route but **without** "Real-time Traffic"
  ([routing coverage](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/product-information/market-coverage)).
  The app copes: the region entry for Israel says `traffic: false`, the layers screen says so when the
  traffic layer is on in Israel, and the directions screen shows "עם תנועה" there only if TomTom reports
  a real delay (≥ 1 minute).
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

## Gaps vs Google Maps, and what would close them

| Gap | Best source | Terms / cost (verified where linked) | Notes |
|---|---|---|---|
| Live traffic and incidents, **Israel** | HERE Traffic API / Traffic Vector Tiles | Israel listed with flow and incidents ([HERE coverage](https://docs.here.com/traffic-api/docs/here-traffic-api-v7-coverage-information)); free 30K traffic tiles/month then $0.113 per 1,000, Traffic API 5K free then $2.75 per 1,000 ([HERE plans](https://developers.here.com/plans)) | Next step: a `HERE_KEY` provider behind the same layer and tool. HERE terms on non-HERE base maps **(unverified)** |
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
