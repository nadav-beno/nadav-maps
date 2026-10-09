import { fileId, type PhotoRec } from './store.ts';

/** EXIF date "2024:05:01 10:20:30" (local time, no zone) or Date -> ms. */
function toTime(v: unknown): number | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (typeof v === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  return null;
}

async function thumbnail(file: File, size = 320): Promise<Blob | null> {
  try {
    // Safari decodes HEIC natively; Chrome can't, and then we just keep no thumbnail.
    const bmp = await createImageBitmap(file, { resizeWidth: size, resizeQuality: 'medium' } as ImageBitmapOptions);
    const canvas = document.createElement('canvas');
    const scale = size / bmp.width;
    canvas.width = size;
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.75));
  } catch {
    return null;
  }
}

export async function readPhoto(file: File): Promise<PhotoRec> {
  const { default: exifr } = await import('exifr');
  let lng: number | null = null, lat: number | null = null, takenAt: number | null = null;
  try {
    const meta = await exifr.parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] });
    if (meta) {
      if (Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude) && !(meta.latitude === 0 && meta.longitude === 0)) {
        lat = meta.latitude;
        lng = meta.longitude;
      }
      takenAt = toTime(meta.DateTimeOriginal) ?? toTime(meta.CreateDate);
    }
  } catch {
    /* no EXIF: keep the photo without location */
  }
  return { id: fileId(file), name: file.name, takenAt: takenAt ?? (file.lastModified || null), lng, lat, thumb: await thumbnail(file), addedAt: Date.now() };
}

/** Import many files with bounded concurrency so phones don't run out of memory. */
export async function importFiles(files: File[], onProgress: (done: number) => void, concurrency = 3): Promise<PhotoRec[]> {
  const out: PhotoRec[] = [];
  let i = 0, done = 0;
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++];
      try {
        out.push(await readPhoto(f));
      } catch {
        /* skip unreadable files */
      }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}
