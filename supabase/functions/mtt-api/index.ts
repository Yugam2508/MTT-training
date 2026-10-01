/**
 * Supabase Edge Function: the MTT Coach cloud API (see app.ts), stored in public.app_storage.
 * Deployed with JWT verification off: the API issues and checks its own session tokens.
 * The table has RLS on and no policies, so only this function (secret key) can touch it.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { handle, type Store } from './app.ts';

function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string') return keys.default;
  } catch { /* fall back to the legacy key */ }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No Supabase secret key available');
  return legacy;
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), { auth: { persistSession: false, autoRefreshToken: false } });
const TABLE = 'app_storage';

const pgStore: Store = {
  async get(key, ifNoneMatch) {
    if (ifNoneMatch) {
      const { data, error } = await db.from(TABLE).select('etag').eq('key', key).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.etag === ifNoneMatch) return 'not-modified';
    }
    const { data, error } = await db.from(TABLE).select('body, etag, content_type').eq('key', key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { body: new Uint8Array(Buffer.from(data.body, 'base64')), etag: data.etag, contentType: data.content_type };
  },
  async put(key, body, contentType, opts) {
    const row = { key, body: Buffer.from(body).toString('base64'), content_type: contentType, etag: `"${randomUUID()}"`, updated_at: new Date().toISOString() };
    if (opts.mode === 'create') {
      const { error } = await db.from(TABLE).insert(row);
      if (error?.code === '23505') return 'exists'; // unique_violation: the key is taken
      if (error) throw error;
    } else if (opts.ifMatch) {
      const { data, error } = await db.from(TABLE).update(row).eq('key', key).eq('etag', opts.ifMatch).select('key');
      if (error) throw error;
      if (!data.length) return 'conflict';
    } else {
      const { error } = await db.from(TABLE).upsert(row, { onConflict: 'key' });
      if (error) throw error;
    }
    return { etag: row.etag };
  },
  async delete(key) {
    const { error } = await db.from(TABLE).delete().eq('key', key);
    if (error) throw error;
  },
};

let secret: Promise<string> | null = null;

/** Token signing key: AUTH_SECRET if set, else generated once and kept in the private table. */
function authSecret(): Promise<string> {
  const fromEnv = Deno.env.get('AUTH_SECRET');
  if (fromEnv) return Promise.resolve(fromEnv);
  secret ??= (async () => {
    const key = 'config/auth-secret';
    let o = await pgStore.get(key);
    if (!o) {
      // First run: create it. If a concurrent request wins the race, read back the stored one.
      await pgStore.put(key, new TextEncoder().encode(randomBytes(32).toString('hex')), 'text/plain', { mode: 'create' });
      o = await pgStore.get(key);
    }
    if (!o || o === 'not-modified') throw new Error('Auth secret missing');
    return new TextDecoder().decode(o.body);
  })().catch((e) => {
    secret = null;
    throw e;
  });
  return secret;
}

// Sessions are bearer tokens (no cookies), so any origin may call the API.
const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, if-match, if-none-match, x-data-encoding, apikey, x-client-info',
  'access-control-expose-headers': 'etag, x-data-encoding',
  'access-control-max-age': '86400',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  let res: Response;
  try {
    res = await handle(req, pgStore, await authSecret());
  } catch (e) {
    console.error('startup error', e);
    res = Response.json({ error: 'server_error', message: 'Something went wrong on the server. Try again.' }, { status: 500 });
  }
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
});
