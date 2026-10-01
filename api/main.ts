/** Vercel Function: the MTT Coach cloud API, backed by a private Vercel Blob store. */
import { get, put, del, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { handle, type Store } from '../server/app.js';

const blobStore: Store = {
  async get(key, ifNoneMatch) {
    const r = await get(key, { access: 'private', useCache: false, ifNoneMatch });
    if (!r) return null;
    if (r.statusCode === 304) return 'not-modified';
    const body = new Uint8Array(await new Response(r.stream).arrayBuffer());
    return { body, etag: r.blob.etag, contentType: r.blob.contentType };
  },
  async put(key, body, contentType, opts) {
    try {
      const r = await put(key, Buffer.from(body), {
        access: 'private',
        contentType,
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(opts.mode === 'create' ? { allowOverwrite: false } : opts.ifMatch ? { ifMatch: opts.ifMatch } : { allowOverwrite: true }),
      });
      return { etag: (r as { etag?: string }).etag ?? '' };
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return 'conflict';
      // A create that fails because the key is taken surfaces as a generic error: confirm by reading.
      if (opts.mode === 'create' && (await get(key, { access: 'private', useCache: false }))) return 'exists';
      throw e;
    }
  },
  async delete(key) {
    try { await del(key); } catch { /* already gone */ }
  },
};

function secret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  // Derive a signing key from the Blob token so no extra secret has to be configured.
  const base = process.env.BLOB_READ_WRITE_TOKEN;
  if (!base) throw new Error('Storage is not configured');
  return createHash('sha256').update(`mtt-coach-auth:${base}`).digest('hex');
}

export default {
  async fetch(request: Request) {
    return handle(request, blobStore, secret());
  },
};
