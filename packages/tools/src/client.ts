import type { ProviderConfig } from '@nm/core';
import type { z } from 'zod';
import type { Tool, ToolContext } from './define.ts';

export interface ToolClient {
  call<I extends z.ZodType, O>(tool: Tool<I, O>, input: z.input<I>, opts?: { signal?: AbortSignal; cache?: boolean }): Promise<O>;
}

/**
 * Runs tools in the browser (or any JS runtime). Validates input with the tool's
 * schema and keeps a small in-memory cache so repeating a search is instant.
 */
export function createToolClient(config: ProviderConfig, lang = 'he', fetchImpl: typeof fetch = (...a) => fetch(...a)): ToolClient {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();
  const TTL = 5 * 60_000;
  const MAX = 200;
  return {
    async call(tool, input, opts = {}) {
      const parsed = tool.input.parse(input);
      const key = `${tool.name}:${JSON.stringify(parsed)}`;
      const hit = opts.cache !== false ? cache.get(key) : undefined;
      if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<never>;
      const ctx: ToolContext = { config, fetch: fetchImpl, signal: opts.signal, lang };
      const value = tool.run(parsed, ctx);
      if (opts.cache !== false) {
        cache.set(key, { at: Date.now(), value });
        if (cache.size > MAX) cache.delete(cache.keys().next().value!);
        // Don't keep failures (or aborted calls) around.
        value.catch(() => cache.delete(key));
      }
      return value;
    },
  };
}

let current: ToolClient | undefined;

/** The shell creates one client at startup; features get it from here. */
export function setToolClient(client: ToolClient): void {
  current = client;
}

export function tools(): ToolClient {
  if (!current) throw new Error('tool client not initialized');
  return current;
}
