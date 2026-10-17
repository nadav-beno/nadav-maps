import { getJson, type ToolContext } from '../define.ts';

/** A free photo from Wikimedia Commons, with what its licence asks us to show. */
export interface Photo {
  url: string;
  thumbUrl: string;
  /** The file page, where the full licence and author are. */
  pageUrl: string;
  title: string;
  author?: string;
  license?: string;
  width?: number;
  height?: number;
}

interface CommonsPage {
  title: string;
  imageinfo?: {
    url: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    descriptionurl: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

const stripHtml = (s?: string) => s?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || undefined;

export function pagesToPhotos(pages: CommonsPage[]): Photo[] {
  const out: Photo[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii || (ii.mime && !/^image\/(jpeg|png|webp)$/.test(ii.mime))) continue;
    const meta = ii.extmetadata ?? {};
    out.push({
      url: ii.url,
      thumbUrl: ii.thumburl ?? ii.url,
      pageUrl: ii.descriptionurl,
      title: p.title.replace(/^File:/, '').replace(/\.[a-z]{3,4}$/i, ''),
      author: stripHtml(meta.Artist?.value)?.slice(0, 80),
      license: stripHtml(meta.LicenseShortName?.value),
      width: ii.thumbwidth,
      height: ii.thumbheight,
    });
  }
  return out;
}

/** Photos taken within `radius` m of a point (Commons geosearch), nearest first. */
export async function commonsPhotosNear(ctx: ToolContext, lng: number, lat: number, radius: number, limit: number): Promise<Photo[]> {
  if (!ctx.config.photosUrl) return [];
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'geosearch',
    ggscoord: `${lat.toFixed(6)}|${lng.toFixed(6)}`,
    ggsradius: String(radius),
    ggsnamespace: '6',
    ggslimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '640',
    iiextmetadatafilter: 'Artist|LicenseShortName',
  });
  const data = await getJson<{ query?: { pages?: Record<string, CommonsPage & { index?: number }> } }>(ctx, `${ctx.config.photosUrl}?${q}`, {}, 'commons');
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pagesToPhotos(pages);
}
