/**
 * Error reporting. Off until a Sentry DSN is configured (VITE_SENTRY_DSN), so no data
 * leaves the device by default. Locations are never included: we report the message,
 * stack and page path only, never the URL hash or query (which hold map position and routes).
 */
export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const send = (message: string, stack?: string) => {
    if (!dsn) return;
    // Minimal envelope to Sentry's store endpoint; avoids a 70 KB SDK.
    try {
      const u = new URL(dsn);
      const key = u.username;
      const project = u.pathname.replace('/', '');
      const endpoint = `${u.protocol}//${u.host}/api/${project}/store/?sentry_key=${key}&sentry_version=7`;
      const body = JSON.stringify({
        message,
        level: 'error',
        platform: 'javascript',
        request: { url: location.origin + location.pathname },
        extra: { stack: stack?.slice(0, 4000) },
        release: __APP_VERSION__,
      });
      navigator.sendBeacon?.(endpoint, body);
    } catch {
      /* never throw from the error reporter */
    }
  };
  addEventListener('error', (e) => send(String(e.message), e.error?.stack));
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    if (r?.name === 'AbortError') return;
    send(String(r?.message ?? r), r?.stack);
  });
}
