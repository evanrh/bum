/**
 * Full page reload. Extracted so islands that reload after a mutation
 * (server-rendered stats only change via a fresh GET) stay testable —
 * jsdom's `location.reload` is non-configurable and cannot be stubbed.
 */
export function reloadPage(): void {
  window.location.reload();
}
