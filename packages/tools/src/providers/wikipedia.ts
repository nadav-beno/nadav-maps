import { getJson, type ToolContext } from '../define.ts';

/** A short "about" text for a place, from Wikipedia (CC BY-SA, shown with a link back). */
export interface PlaceSummary {
  title: string;
  extract: string;
  url: string;
  lang: string;
  imageUrl?: string;
}

interface RestSummary {
  type?: string;
  title: string;
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
  content_urls?: { desktop?: { page?: string } };
}

/** "he:תל אביב" -> ['he', 'תל אביב']; a bare title is taken as English (OSM's convention). */
export function parseWikipediaTag(tag: string): [lang: string, title: string] | null {
  const m = /^([a-z-]{2,12}):(.+)$/.exec(tag.trim());
  if (m) return [m[1], m[2].trim()];
  return tag.trim() ? ['en', tag.trim()] : null;
}

async function sitelinks(ctx: ToolContext, qid: string, langs: string[]): Promise<[string, string] | null> {
  const sites = langs.map((l) => `${l}wiki`).join('|');
  const data = await getJson<{ entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
    ctx,
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=${encodeURIComponent(sites)}&format=json&origin=*`,
    {},
    'wikidata',
  );
  const links = data.entities?.[qid]?.sitelinks ?? {};
  for (const l of langs) if (links[`${l}wiki`]) return [l, links[`${l}wiki`].title];
  return null;
}

export async function wikipediaSummary(ctx: ToolContext, input: { wikipedia?: string; wikidata?: string }): Promise<PlaceSummary | null> {
  const langs = [...new Set([ctx.lang, 'en'])];
  let target: [string, string] | null = null;
  const tag = input.wikipedia ? parseWikipediaTag(input.wikipedia) : null;
  // Prefer an article in the UI language, which Wikidata knows even when the OSM tag points elsewhere.
  if (input.wikidata && /^Q\d+$/.test(input.wikidata) && tag?.[0] !== ctx.lang) target = await sitelinks(ctx, input.wikidata, langs);
  target ??= tag;
  if (!target) return null;
  const [lang, title] = target;
  const s = await getJson<RestSummary>(
    ctx,
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    {},
    'wikipedia',
  );
  if (!s.extract || s.type === 'disambiguation') return null;
  return {
    title: s.title,
    extract: s.extract,
    url: s.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    lang,
    imageUrl: s.thumbnail?.source ?? s.originalimage?.source,
  };
}
