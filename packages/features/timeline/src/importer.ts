import { putEdits, putPoints, putSegs } from './db.ts';
import { parseTimelineExport, type ImportKind, type ImportResult } from './google.ts';
import { thin } from './segment.ts';

/** Files above this are parsed in a worker so the map stays responsive. */
const WORKER_BYTES = 4 * 1024 * 1024;

export class ImportError extends Error {
  reason: 'zip' | 'json' | 'format';
  constructor(reason: 'zip' | 'json' | 'format') {
    super(reason);
    this.reason = reason;
  }
}

function inWorker(file: File): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: ImportResult }>) => {
      w.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new ImportError('json'));
    };
    w.onerror = () => {
      w.terminate();
      reject(new ImportError('json'));
    };
    w.postMessage(file);
  });
}

export async function readExport(file: File): Promise<ImportResult> {
  if (/\.zip$/i.test(file.name)) throw new ImportError('zip');
  let result: ImportResult;
  if (file.size > WORKER_BYTES && typeof Worker !== 'undefined') result = await inWorker(file);
  else {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      throw new ImportError('json');
    }
    result = parseTimelineExport(json);
    result.points = thin(result.points);
  }
  if (result.kind === 'unknown') throw new ImportError('format');
  return result;
}

export interface ImportSummary {
  files: number;
  failed: number;
  kinds: ImportKind[];
  points: number;
  stays: number;
  moves: number;
  /** Newest time in the imported data, to open that day. */
  newest?: number;
  firstError?: ImportError['reason'];
}

export async function importFiles(files: File[], onProgress?: (done: number) => void): Promise<ImportSummary> {
  const s: ImportSummary = { files: files.length, failed: 0, kinds: [], points: 0, stays: 0, moves: 0 };
  let done = 0;
  for (const f of files) {
    try {
      const r = await readExport(f);
      await putPoints(r.points);
      await putSegs(r.segs);
      await putEdits(r.edits);
      s.kinds.push(r.kind);
      s.points += r.points.length;
      for (const g of r.segs) {
        if (g.kind === 'stay') s.stays++;
        else s.moves++;
      }
      const times = [...r.points.map((p) => p.t), ...r.segs.map((g) => g.start)];
      if (times.length) {
        let max = -Infinity;
        for (const t of times) if (t > max) max = t;
        s.newest = Math.max(s.newest ?? -Infinity, max);
      }
    } catch (e) {
      s.failed++;
      s.firstError ??= e instanceof ImportError ? e.reason : 'json';
    }
    onProgress?.(++done);
  }
  return s;
}
