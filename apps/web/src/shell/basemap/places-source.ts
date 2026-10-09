import * as maplibregl from 'maplibre-gl';
import { FetchSource, PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { load, save } from '@nm/core/app';

/**
 * Overture places come as one big PMTiles file per monthly release, read with HTTP range
 * requests straight from Overture's public bucket (no server of ours). Releases are removed
 * after a few months, so a URL with "{release}" is resolved to the newest one in the bucket.
 */
const DAY = 24 * 3600 * 1000;

/** Newest first, from an S3 ListObjectsV2 response of "<bucket>/?prefix=tiles/&delimiter=/". */
export function parseReleases(xml: string): string[] {
  return [...xml.matchAll(/<Prefix>tiles\/([^/<]+)\/<\/Prefix>/g)].map((m) => m[1]).sort().reverse();
}

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    return r.ok;
  } catch {
    return false;
  }
}

async function resolveRelease(template: string): Promise<string> {
  const cached = load<{ url: string; at: number } | null>('places:release', null);
  if (cached && cached.url.length && Date.now() - cached.at < DAY && cached.url.startsWith(template.split('{release}')[0])) return cached.url;
  const base = template.slice(0, template.indexOf('/tiles/'));
  const res = await fetch(`${base}/?list-type=2&prefix=tiles/&delimiter=/`);
  if (!res.ok) throw new Error(`places index ${res.status}`);
  // The newest release can still be uploading: take the newest one whose file answers.
  for (const r of parseReleases(await res.text()).slice(0, 3)) {
    const url = template.replace('{release}', r);
    if (await exists(url)) {
      save('places:release', { url, at: Date.now() });
      return url;
    }
  }
  throw new Error('no places release');
}

/** A PMTiles source whose real URL is found on first use. */
class LatestSource implements Source {
  private inner?: Promise<FetchSource>;
  constructor(private template: string) {}
  getKey(): string {
    // No braces in the key: it becomes part of tile URLs MapLibre templates.
    return this.template.replace('{release}', 'latest');
  }
  private source(): Promise<FetchSource> {
    this.inner ??= resolveRelease(this.template).then((u) => new FetchSource(u));
    // A failed lookup is retried on the next tile request instead of sticking.
    this.inner.catch(() => (this.inner = undefined));
    return this.inner;
  }
  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    return (await this.source()).getBytes(offset, length, signal, etag);
  }
}

let protocol: Protocol | undefined;
const urls = new Map<string, string>();

/** Registers pmtiles:// once and returns the style source URL for the places archive ('' when off). */
export function placesSourceUrl(template: string): string {
  if (!template) return '';
  const known = urls.get(template);
  if (known) return known;
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
  }
  const instance = new PMTiles(template.includes('{release}') ? new LatestSource(template) : template);
  protocol.add(instance);
  const url = `pmtiles://${instance.source.getKey()}`;
  urls.set(template, url);
  return url;
}
