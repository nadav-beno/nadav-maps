import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { providersFromEnv, type ProviderConfig } from '@nm/core';
import { ProviderError, TOOLS, type Tool, type ToolContext } from '@nm/tools';

export interface ServerOptions {
  config?: ProviderConfig;
  /** Allowed browser origins for the REST API. */
  origins?: string[];
  /** Requests per minute per client. */
  rateLimit?: number;
  fetch?: typeof fetch;
}

/**
 * One server, two doors to the same tools:
 *   POST /api/tools/<name>   JSON in, JSON out (the web app, scripts)
 *   /mcp                     Model Context Protocol, for Claude and other AI clients
 * Logs never contain coordinates or search text: only tool name, status and duration.
 */
export function createApp(opts: ServerOptions = {}): Hono {
  const config = opts.config ?? providersFromEnv(process.env);
  const doFetch = opts.fetch ?? fetch;
  const limit = opts.rateLimit ?? Number(process.env.RATE_LIMIT_PER_MIN ?? 120);
  const app = new Hono();

  app.use('/api/*', cors({ origin: opts.origins ?? (process.env.ALLOWED_ORIGINS?.split(',') || ['*']) }));
  app.use('/mcp', cors({ origin: '*', allowHeaders: ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'authorization'], exposeHeaders: ['mcp-session-id'] }));

  // Simple fixed-window rate limit per client address. Enough for one server; swap for Redis when we run several.
  const hits = new Map<string, { n: number; reset: number }>();
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    const key = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'local';
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > limit) {
      c.header('retry-after', String(Math.ceil((h.reset - now) / 1000)));
      return c.json({ error: 'rate_limited', message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' }, 429);
    }
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return next();
  });

  const ctxFor = (signal?: AbortSignal, lang = 'he'): ToolContext => ({ config, fetch: doFetch, signal, lang });
  const byName = new Map(TOOLS.map((t) => [t.name, t as Tool]));

  const log = (tool: string, status: string, start: number) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), tool, status, ms: Date.now() - start }));

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/api/tools', (c) =>
    c.json(TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, input: z.toJSONSchema(t.input) }))),
  );

  app.post('/api/tools/:name', async (c) => {
    const tool = byName.get(c.req.param('name'));
    if (!tool) return c.json({ error: 'unknown_tool' }, 404);
    const start = Date.now();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'bad_json' }, 400);
    }
    const parsed = tool.input.safeParse(body);
    if (!parsed.success) {
      log(tool.name, 'invalid', start);
      return c.json({ error: 'invalid_input', issues: parsed.error.issues }, 400);
    }
    try {
      const result = await tool.run(parsed.data, ctxFor(c.req.raw.signal, c.req.header('accept-language')?.slice(0, 2) || 'he'));
      log(tool.name, 'ok', start);
      return c.json(result as object);
    } catch (e) {
      log(tool.name, e instanceof ProviderError ? `provider_${e.status ?? 'down'}` : 'error', start);
      if (e instanceof ProviderError) return c.json({ error: 'provider_error', message: e.message }, 502);
      return c.json({ error: 'failed', message: (e as Error).message }, 500);
    }
  });

  app.all('/mcp', async (c) => {
    // Stateless: a fresh server per request, so any instance can answer any request.
    const server = buildMcpServer((signal) => ctxFor(signal));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    c.req.raw.signal.addEventListener('abort', () => void server.close());
    return res;
  });

  return app;
}

export function buildMcpServer(ctx: (signal?: AbortSignal) => ToolContext): McpServer {
  const server = new McpServer(
    { name: 'nadav-maps', version: '0.2.0' },
    { instructions: 'Maps tools: search places worldwide (Hebrew-aware), place details, nearby by category, and routes by car, foot or bike with Hebrew turn-by-turn, public transport, and (when the server has a TomTom key) live traffic incidents and traffic-aware car times. Coordinates are [lng, lat].' },
  );
  for (const tool of TOOLS as Tool[]) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input as never, annotations: { readOnlyHint: true, openWorldHint: true } },
      (async (input: unknown, extra: { signal?: AbortSignal }) => {
        const start = Date.now();
        try {
          const result = await tool.run(input as never, ctx(extra?.signal));
          console.log(JSON.stringify({ at: new Date().toISOString(), tool: tool.name, via: 'mcp', status: 'ok', ms: Date.now() - start }));
          return { content: [{ type: 'text', text: JSON.stringify(compact(tool.name, result)) }] };
        } catch (e) {
          console.log(JSON.stringify({ at: new Date().toISOString(), tool: tool.name, via: 'mcp', status: 'error', ms: Date.now() - start }));
          return { isError: true, content: [{ type: 'text', text: (e as Error).message }] };
        }
      }) as never,
    );
  }
  return server;
}

/** AI clients don't need thousands of route coordinates; keep the answer small. */
function compact(name: string, result: unknown): unknown {
  if (name === 'get_directions' && Array.isArray(result)) {
    return result.map((r: { geometry?: unknown[] }) => ({ ...r, geometry: undefined, geometryPoints: r.geometry?.length }));
  }
  return result;
}
