// Supabase Edge Function "flights": the CORS relay for the free ADS-B feeds, and the shared
// world-cell cache behind the zoomed-out live flights map.
// The logic lives in packages/tools/src/flights-proxy.ts and world-cells.ts (no imports, unit-tested there).
// The cache tables: supabase/migrations/*_flight_cells.sql.
// Deploy: `supabase functions deploy flights --no-verify-jwt` (it is public; it checks the Origin itself).
import { handleFlightsRelay } from '../../../packages/tools/src/flights-proxy.ts';
import { postgrestStore } from '../../../packages/tools/src/world-cells.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const store = url && key ? postgrestStore(url, key) : undefined;
const defer = typeof EdgeRuntime !== 'undefined' ? (p: Promise<unknown>) => EdgeRuntime!.waitUntil(p) : undefined;

Deno.serve((req) => handleFlightsRelay(req, fetch, Date.now(), { store, defer }));
