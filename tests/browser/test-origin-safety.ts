/** Mutating browser fixtures must never silently target a live deployment. */
export function isLoopbackTestOrigin(value: string): boolean {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function requireLocalTestOrigin(value: string): string {
  if (!isLoopbackTestOrigin(value)) throw new Error('This browser test is local-only. Use a localhost, 127.0.0.1, or [::1] origin.');
  return new URL(value).origin;
}

export function requireOverlayMutationOptIn(value: string, acknowledgedOrigin?: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Overlay test requires a plain HTTP(S) origin without credentials, path, or query.');
  if (!isLoopbackTestOrigin(value) && acknowledgedOrigin !== url.origin) {
    throw new Error('Refusing remote scene-mutating overlay test. Only with explicit authorization for an idle test deployment, set OVERLAY_TEST_ALLOW_REMOTE_MUTATION to the exact target origin. Never run against an active user camera.');
  }
  return url.origin;
}
