import { z } from 'zod';
import type { ProviderConfig } from '@nm/core';

export interface ToolContext {
  config: ProviderConfig;
  fetch: typeof fetch;
  signal?: AbortSignal;
  /** UI language for names and instructions. */
  lang: string;
}

/**
 * One definition, three uses: called directly by the web app, exposed as REST
 * (POST /api/tools/<name>) and as an MCP tool for Claude and other AI clients.
 * The Zod schema is the single source of truth for validation and docs.
 */
export interface Tool<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  title: string;
  description: string;
  input: I;
  run(input: z.infer<I>, ctx: ToolContext): Promise<O>;
}

export function defineTool<I extends z.ZodType, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

export class ProviderError extends Error {
  readonly status?: number;
  readonly provider?: string;
  constructor(message: string, status?: number, provider?: string) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
  }
}

/** fetch + JSON with a timeout and readable errors. */
export async function getJson<T>(ctx: ToolContext, url: string, init: RequestInit = {}, provider = 'provider', timeoutMs = 12000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => ac.abort(ctx.signal?.reason);
  ctx.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await ctx.fetch(url, { ...init, signal: ac.signal });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      throw new ProviderError(`${provider} ${res.status}${detail ? `: ${detail}` : ''}`, res.status, provider);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (ctx.signal?.aborted) throw e;
    const timeout = (e as Error)?.name === 'TimeoutError' || ac.signal.reason?.name === 'TimeoutError';
    throw new ProviderError(timeout ? `${provider} timeout` : `${provider} unreachable`, undefined, provider);
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onAbort);
  }
}
