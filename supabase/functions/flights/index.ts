// Supabase Edge Function "flights": the CORS relay for the free ADS-B feeds.
// The logic lives in packages/tools/src/flights-proxy.ts (no imports, unit-tested there).
// Deploy: `supabase functions deploy flights --no-verify-jwt` (it is public; it checks the Origin itself).
import { handleFlightsRelay } from '../../../packages/tools/src/flights-proxy.ts';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

Deno.serve((req) => handleFlightsRelay(req));
