import { randomUUID } from 'node:crypto';
import { put, get } from '@vercel/blob';

// Private records contain only delivery state and a hashed event identity, never customer data.
export function createNotificationStore(blob = { put, get }) {
  const options = () => ({ access: 'private', addRandomSuffix: false, contentType: 'application/json', abortSignal: AbortSignal.timeout(4000) });
  async function read(path) {
    const response = await blob.get(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(4000) });
    if (!response) return null;
    if (response.statusCode !== 200) throw Error('Notification state unavailable');
    return { ...await new Response(response.stream).json(), etag: response.blob.etag };
  }
  return {
    async claim(id) {
      const path = 'notifications/v1/' + id + '.json';
      const previous = await read(path);
      if (previous && previous.status !== 'retryable') return null;
      const record = { status: 'sending', owner: randomUUID(), updatedAt: new Date().toISOString() };
      try {
        const result = await blob.put(path, JSON.stringify(record), { ...options(), allowOverwrite: Boolean(previous), ...(previous ? { ifMatch: previous.etag } : {}) });
        return { path, etag: result.etag, owner: record.owner };
      } catch (error) {
        // A competing worker or an uncertain write must never authorize another delivery.
        const current = await read(path);
        if (current && current.status !== 'retryable') return null;
        throw error;
      }
    },
    async finish(claim, status) {
      await blob.put(claim.path, JSON.stringify({ status, owner: claim.owner, updatedAt: new Date().toISOString() }), { ...options(), allowOverwrite: true, ifMatch: claim.etag });
    }
  };
}
export const notificationStore = createNotificationStore();
let health;
export async function notificationStorageAvailable() {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return false;
  if (health?.until > Date.now()) return health.result;
  const result = (async () => {
    try {
      // A fixed private marker verifies real read/write access without contacting Pushcut.
      const claim = await notificationStore.claim('storage-check');
      if (claim) await notificationStore.finish(claim, 'delivered');
      return true;
    } catch { console.warn('notification_storage_unavailable'); return false; }
  })();
  health = { result, until: Date.now() + 300000 };
  return result;
}
