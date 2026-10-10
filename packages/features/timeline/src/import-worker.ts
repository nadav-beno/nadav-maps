import { parseTimelineExport } from './google.ts';
import { thin } from './segment.ts';

/**
 * Parses a big export (Records.json can be hundreds of MB) off the main thread. Errors
 * are reported without their message: JSON.parse messages quote the file, which holds
 * coordinates.
 */
const scope = self as unknown as { onmessage: ((e: MessageEvent<File>) => void) | null; postMessage(m: unknown): void };
scope.onmessage = async (e: MessageEvent<File>) => {
  try {
    const result = parseTimelineExport(JSON.parse(await e.data.text()));
    result.points = thin(result.points);
    scope.postMessage({ ok: true, result });
  } catch {
    scope.postMessage({ ok: false });
  }
};
