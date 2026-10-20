import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  atlasClockOffset,
  atlasCovers,
  atlasCoversPoint,
  atlasFlowTiles,
  atlasHideAt,
  atlasIncidentCategory,
  atlasIncidentsUrl,
  atlasRetryDelay,
  atlasStatusUrl,
  atlasUsable,
  parseAtlasIncidents,
  parseAtlasStatus,
} from './atlas.ts';
import { providersFromEnv, withDevOverrides } from './config.ts';

/** The public status Atlas published on 2026-10-17 (shape and values as returned). */
const STATUS = {
  stale: false,
  observed_at: 1792245180,
  tiles_version: '51924144d338b9a94a3ccee8',
  coverage: {
    bbox: [113.85021439572637, 22.23663740592147, 114.28441209032988, 22.5486044497214],
    kind: 'matched_road_segments',
    geojson_url: 'https://atlas-traffic-command.nadav747710.chatgpt.site/api/v1/coverage.geojson?v=51924144d338b9a94a3ccee8',
  },
  source_status: 'ok',
  last_success_at: '2026-10-17T13:59:58.981Z',
  last_error_at: null,
  scheduler: { status: 'not_configured', target_interval_seconds: 120 },
  matched_segments: 4461,
  unmatched_segments: 22,
  redistribution_status: 'permitted_with_attribution_under_data_gov_hk_terms',
  terms_url: 'https://data.gov.hk/en/terms-and-conditions',
  attribution: 'Traffic speeds and road geometry: Transport Department, Government of the Hong Kong Special Administrative Region; DATA.GOV.HK and CSDI Portal.',
};

describe('atlas config', () => {
  it('is off without a key, reads it from env and from ?atlas= on localhost only', () => {
    expect(providersFromEnv({}).atlasKey).toBe('');
    expect(providersFromEnv({ VITE_ATLAS_KEY: ' k ' }, 'VITE_').atlasKey).toBe('k');
    expect(providersFromEnv({ ATLAS_URL: 'https://a.test' }).atlasUrl).toBe('https://a.test');
    const cfg = providersFromEnv({});
    expect(withDevOverrides(cfg, 'http://localhost:4173/?atlas=dev').atlasKey).toBe('dev');
    expect(withDevOverrides(cfg, 'https://nadav-beno.github.io/nadav-maps/?atlas=evil').atlasKey).toBe('');
  });
});

describe('atlas status', () => {
  it('parses the published status and is usable', () => {
    const s = parseAtlasStatus(STATUS);
    expect(s).toMatchObject({ stale: false, tilesVersion: '51924144d338b9a94a3ccee8', sourceStatus: 'ok', observedAt: 1792245180 });
    expect(atlasUsable(s)).toBe(true);
  });
  it('is not usable when stale, unhealthy, without version or coverage', () => {
    expect(atlasUsable(parseAtlasStatus({ ...STATUS, stale: true }))).toBe(false);
    expect(atlasUsable(parseAtlasStatus({ ...STATUS, source_status: 'error' }))).toBe(false);
    expect(atlasUsable(parseAtlasStatus({ ...STATUS, tiles_version: null }))).toBe(false);
    expect(atlasUsable(parseAtlasStatus({ ...STATUS, coverage: null }))).toBe(false);
    expect(atlasUsable(null)).toBe(false);
  });
  it('rejects malformed answers', () => {
    expect(parseAtlasStatus('nope')).toBeNull();
    expect(parseAtlasStatus({ ...STATUS, stale: 'no' })).toBeNull();
    expect(parseAtlasStatus({ ...STATUS, source_status: 'great' })).toBeNull();
    expect(parseAtlasStatus({ ...STATUS, tiles_version: '../x' })?.tilesVersion).toBeNull();
    expect(parseAtlasStatus({ ...STATUS, coverage: { bbox: [1, 2, 0, 3] } })?.coverage).toBeNull();
    expect(parseAtlasStatus({ ...STATUS, terms_url: 'javascript:alert(1)' })?.termsUrl).toBe('');
  });
});

describe('atlas urls and coverage', () => {
  it('builds the status and tile URLs', () => {
    expect(atlasStatusUrl('https://a.test/')).toBe('https://a.test/api/status');
    expect(atlasFlowTiles('https://a.test', 'k/1', 'v1')).toBe('https://a.test/api/v1/tiles/flow/{z}/{x}/{y}.pbf?key=k%2F1&v=v1');
  });
  it('covers Hong Kong, not Israel', () => {
    const s = parseAtlasStatus(STATUS)!;
    expect(atlasCoversPoint(s, [114.17, 22.3])).toBe(true);
    expect(atlasCoversPoint(s, [34.78, 32.08])).toBe(false);
    expect(atlasCovers(s, [114.2, 22.5, 114.4, 22.7])).toBe(true);
  });
});

describe('atlasRetryDelay', () => {
  it('honours Retry-After with jitter and backs off otherwise', () => {
    expect(atlasRetryDelay(0, '10', () => 0)).toBe(10_000);
    expect(atlasRetryDelay(0, '10', () => 1)).toBe(12_000);
    expect(atlasRetryDelay(0, null, () => 0)).toBe(30_000);
    expect(atlasRetryDelay(2, null, () => 0)).toBe(120_000);
    expect(atlasRetryDelay(20, null, () => 0)).toBe(15 * 60_000);
  });
});

describe('atlas v4 timing', () => {
  it('reads server_time and stale_after, and hides on our clock', () => {
    const s = parseAtlasStatus({ ...STATUS, server_time: 1792245300, stale_after: 1792245780 })!;
    expect(s).toMatchObject({ serverTime: 1792245300, staleAfter: 1792245780 });
    expect(parseAtlasStatus(STATUS)).toMatchObject({ serverTime: null, staleAfter: null });
    // Our clock is an hour behind Atlas's; the request took 200 ms.
    const sent = 1792245300_000 - 3_600_000 - 100;
    const offset = atlasClockOffset(1792245300, sent, sent + 200);
    expect(offset).toBe(3_600_000);
    expect(atlasHideAt(s, offset)).toBe(1792245780_000 - 3_600_000);
    expect(atlasHideAt(parseAtlasStatus(STATUS)!, offset)).toBeNull();
  });
});

describe('atlas incidents', () => {
  it('builds the bbox URL with the key', () => {
    expect(atlasIncidentsUrl('https://a.test/', 'k', [113.850214, 22.23, 114.29, 22.55])).toBe(
      'https://a.test/api/v1/incidents?key=k&bbox=113.85021,22.23,114.29,22.55&limit=500',
    );
  });
  it('keeps located announcements that are not closed and counts the unlocated ones', () => {
    const r = parseAtlasIncidents({
      type: 'FeatureCollection',
      unlocated_count: 1,
      features: [
        {
          geometry: { type: 'Point', coordinates: [114.2, 22.34] },
          properties: { incident_id: 'a', type: 'Traffic Accident', description: 'Two lanes blocked', location_description: 'Lung Cheung Road', direction_description: 'Kowloon bound', status: 'active', announced_at: 1792215000, start_time: null, severity: null },
        },
        { geometry: { type: 'Point', coordinates: [114.2, 22.34] }, properties: { incident_id: 'b', type: 'Road Closure', status: 'closed' } },
        { geometry: null, properties: { incident_id: 'c', type: 'Road Closure', status: 'active' } },
        { geometry: { type: 'Point', coordinates: [500, 22] }, properties: { incident_id: 'd', status: 'unknown' } },
      ],
    })!;
    expect(r.unlocated).toBe(1);
    expect(r.incidents).toEqual([
      { id: 'a', category: 1, heading: 'Traffic Accident', description: 'Two lanes blocked', location: 'Lung Cheung Road', direction: 'Kowloon bound', announcedAt: '2026-10-17T05:30:00.000Z', at: [114.2, 22.34] },
    ]);
    expect(r.stale).toBe(false);
    expect(parseAtlasIncidents({ error: { code: 'unavailable' } })).toBeNull();
  });
  it('shows nothing from a stale incidents answer', () => {
    const one = { geometry: { type: 'Point', coordinates: [114.2, 22.34] }, properties: { incident_id: 'a', type: 'Traffic Accident', status: 'active' } };
    expect(parseAtlasIncidents({ features: [one], stale: true, source_status: 'ok', unlocated_count: 2 })).toEqual({ incidents: [], unlocated: 0, stale: true });
    expect(parseAtlasIncidents({ features: [one], stale: false, source_status: 'error' })?.stale).toBe(true);
    expect(parseAtlasIncidents({ features: [one], stale: false, source_status: 'ok' })?.incidents).toHaveLength(1);
  });
  it('reads the e2e incidents fixture (OpenAPI shape)', () => {
    const r = parseAtlasIncidents(JSON.parse(readFileSync(new URL('../../../e2e/atlas/incidents.json', import.meta.url), 'utf8')))!;
    expect(r).toMatchObject({ unlocated: 1, stale: false, incidents: [{ id: 'test-1', category: 1, announcedAt: '2026-10-17T05:30:00.000Z' }] });
  });
  it('maps source headings to our categories only on clear words', () => {
    expect(atlasIncidentCategory('Road Closure')).toBe(8);
    expect(atlasIncidentCategory('Lane Closure')).toBe(7);
    expect(atlasIncidentCategory('Road Works')).toBe(9);
    expect(atlasIncidentCategory('Traffic Congestion')).toBe(6);
    expect(atlasIncidentCategory('Special Traffic Arrangement')).toBe(0);
  });
});

/** Atlas's own v4 offline fixture pack (e2e/atlas/v4), unchanged: checked against its manifest. */
describe('atlas v4 fixture pack', () => {
  const dir = new URL('../../../e2e/atlas/v4/', import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, dir));
  const status = (name: string) => parseAtlasStatus(JSON.parse(read(`status-${name}.json`).toString('utf8')));
  it('matches the manifest hashes', () => {
    const manifest = JSON.parse(read('manifest.json').toString('utf8')) as { fixture_version: number; files: { name: string; bytes: number; sha256: string }[] };
    expect(manifest.fixture_version).toBe(4);
    for (const f of manifest.files) {
      const b = read(f.name);
      expect([f.name, b.length, createHash('sha256').update(b).digest('hex')]).toEqual([f.name, f.bytes, f.sha256]);
    }
  });
  it('draws only from the ok status, and hides at its stale_after on Atlas clock', () => {
    const ok = status('ok')!;
    expect(atlasUsable(ok)).toBe(true);
    expect(ok.staleAfter! - ok.serverTime!).toBe(480);
    // Device clock one hour behind Atlas: hiding still comes 480 s after the read.
    const at = (ok.serverTime! - 3600) * 1000;
    expect(atlasHideAt(ok, atlasClockOffset(ok.serverTime!, at, at))! - at).toBe(480_000);
    for (const n of ['stale', 'error']) expect([n, atlasUsable(status(n))]).toEqual([n, false]);
    const off = status('unavailable')!;
    expect([off.sourceStatus, off.coverage, off.tilesVersion, off.staleAfter, atlasUsable(off)]).toEqual(['unavailable', null, null, null, false]);
  });
});
