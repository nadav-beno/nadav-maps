import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROVIDERS } from '@nm/core';
import { createApp } from './app.ts';

vi.spyOn(console, 'log').mockImplementation(() => {});

const photon = vi.fn(async () =>
  new Response(JSON.stringify({ features: [{ geometry: { coordinates: [34.78, 32.08] }, properties: { osm_type: 'N', osm_id: 1, name: 'דיזנגוף סנטר', city: 'תל אביב' } }] }), {
    headers: { 'content-type': 'application/json' },
  }),
);
const app = createApp({ config: DEFAULT_PROVIDERS, fetch: photon as typeof fetch, rateLimit: 1000, origins: ['*'] });

const mcp = (body: unknown) =>
  app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });

describe('server', () => {
  it('reports health and lists tools with JSON schemas', async () => {
    expect(await (await app.request('/health')).json()).toEqual({ ok: true });
    const list = (await (await app.request('/api/tools')).json()) as { name: string; input: { type: string } }[];
    expect(list.map((t) => t.name)).toContain('search_places');
    expect(list.every((t) => t.input.type === 'object')).toBe(true);
  });
  it('runs a tool over REST and validates input', async () => {
    const ok = await app.request('/api/tools/search_places', { method: 'POST', body: JSON.stringify({ query: 'דיזנגוף' }), headers: { 'content-type': 'application/json' } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { id: string }[])[0].id).toBe('osm:n1');
    const bad = await app.request('/api/tools/search_places', { method: 'POST', body: JSON.stringify({ query: '' }) });
    expect(bad.status).toBe(400);
    expect((await app.request('/api/tools/nope', { method: 'POST', body: '{}' })).status).toBe(404);
  });
  it('speaks MCP: initialize, list, call', async () => {
    const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('nadav-maps');
    const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['search_places', 'get_directions', 'search_nearby']));
    const call = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_places', arguments: { query: 'דיזנגוף' } } });
    const text = ((await call.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
    expect(JSON.parse(text)[0].name).toBe('דיזנגוף סנטר');
  });
  it('rate limits', async () => {
    const small = createApp({ config: DEFAULT_PROVIDERS, fetch: photon as typeof fetch, rateLimit: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await small.request('/api/tools')).status);
    expect(codes).toEqual([200, 200, 429]);
  });
});
