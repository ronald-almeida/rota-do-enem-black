import assert from 'node:assert/strict';
import { createNotificationStore } from '../../lib/notification-store.js';

export function fakeBlob() {
  const records = new Map(); let version = 0;
  return {
    records,
    async get(path, options) {
      assert.equal(options.access, 'private'); assert.equal(options.useCache, false);
      const record = records.get(path);
      return record ? { statusCode: 200, blob: { etag: record.etag }, stream: new Response(record.body).body } : null;
    },
    async put(path, body, options) {
      assert.equal(options.access, 'private'); assert.equal(options.addRandomSuffix, false);
      const current = records.get(path);
      if ((!options.allowOverwrite && current) || (options.ifMatch && options.ifMatch !== current?.etag)) throw Error('Write conflict');
      const etag = 'version-' + ++version;
      records.set(path, { body, etag }); return { etag };
    }
  };
}
export function fakeNotificationStore() { return createNotificationStore(fakeBlob()); }
