// Supabase Edge Function "ships": live AIS ships for the map. Keeps one shared aisstream.io
// stream for every viewer (the key stays here, as aisstream requires) and caches positions in Postgres.
// The logic lives in packages/tools/src/ships-relay.ts (no imports, unit-tested there).
// The tables: supabase/migrations/*_ships.sql. Secret: AISSTREAM_API_KEY (without it only the cache is served).
// Deploy: `supabase functions deploy ships --no-verify-jwt` (it is public; it checks the Origin itself).
import { handleShipsRelay, postgrestShipStore, type MiniSocket } from '../../../packages/tools/src/ships-relay.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const url = Deno.env.get('SUPABASE_URL');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const key = Deno.env.get('AISSTREAM_API_KEY')?.trim() || undefined;
const store = url && service ? postgrestShipStore(url, service) : undefined;
const defer = typeof EdgeRuntime !== 'undefined' ? (p: Promise<unknown>) => EdgeRuntime!.waitUntil(p) : undefined;
const socket = (u: string) => new WebSocket(u) as unknown as MiniSocket;

Deno.serve((req) => handleShipsRelay(req, { store, key, defer, socket }));
