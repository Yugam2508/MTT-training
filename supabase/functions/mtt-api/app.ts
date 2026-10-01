/**
 * MTT Coach cloud API: accounts and per-account data sync.
 * Storage-agnostic: runs on Supabase (Postgres) in production and on an in-memory or file
 * store in tests and local development. Shared by the Edge Function and the Vite dev server,
 * so it only uses node: built-ins that both Node and Deno provide.
 */
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

export interface StoredObject {
  body: Uint8Array;
  etag: string;
  contentType: string;
}

export interface Store {
  /** Returns null when the object doesn't exist. `ifNoneMatch` -> 'not-modified' when unchanged. */
  get(key: string, ifNoneMatch?: string): Promise<StoredObject | 'not-modified' | null>;
  /**
   * Writes an object. `mode: 'create'` fails with 'exists' if present; `ifMatch` fails with
   * 'conflict' when the current ETag differs. Returns the new ETag.
   */
  put(key: string, body: Uint8Array, contentType: string, opts: { mode: 'create' } | { mode: 'overwrite'; ifMatch?: string }): Promise<{ etag: string } | 'exists' | 'conflict'>;
  delete(key: string): Promise<void>;
}

interface UserRecord {
  id: string;
  username: string;
  salt: string;
  hash: string;
  /** Password version: bumped on password change to invalidate old sessions. */
  pv: number;
  createdAt: number;
}

interface TokenPayload { uid: string; un: string; pv: number; exp: number }

const TOKEN_DAYS = 120;
const MAX_DATA_BYTES = 4 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

const enc = new TextEncoder();
const dec = new TextDecoder();

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function sign(payload: TokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`v1.${body}`).digest('base64url');
  return `v1.${body}.${sig}`;
}

function verify(token: string, secret: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = createHmac('sha256', secret).update(`v1.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as TokenPayload;
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

const userKey = (username: string) => `users/${username}.json`;
const dataKey = (uid: string) => `data/${uid}.bin`;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

const err = (status: number, error: string, message: string) => json(status, { error, message });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readUser(store: Store, username: string): Promise<UserRecord | null> {
  const o = await store.get(userKey(username));
  if (!o || o === 'not-modified') return null;
  return JSON.parse(dec.decode(o.body)) as UserRecord;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const t = await req.text();
    if (t.length > 10_000) return {};
    const v = JSON.parse(t);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function normUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const u = v.trim().toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}

function validPassword(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 200;
}

function session(user: UserRecord, secret: string) {
  const token = sign({ uid: user.id, un: user.username, pv: user.pv, exp: Date.now() + TOKEN_DAYS * 86400_000 }, secret);
  return { token, user: { id: user.id, username: user.username, createdAt: user.createdAt } };
}

async function authenticate(req: Request, store: Store, secret: string): Promise<UserRecord | Response> {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const p = verify(token, secret);
  if (!p) return err(401, 'unauthorized', 'Please sign in again.');
  const user = await readUser(store, p.un);
  if (!user || user.id !== p.uid || user.pv !== p.pv) return err(401, 'unauthorized', 'Your session has ended. Please sign in again.');
  return user;
}

export async function handle(req: Request, store: Store, secret: string): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get('a') ?? '';
  const method = req.method.toUpperCase();
  try {
    if (action === 'health') return json(200, { ok: true });

    if (action === 'register' && method === 'POST') {
      const body = await readBody(req);
      const username = normUsername(body.username);
      if (!username) return err(400, 'bad_username', 'Usernames are 3–24 characters: letters, numbers, - and _.');
      if (!validPassword(body.password)) return err(400, 'bad_password', 'Passwords need at least 8 characters.');
      const salt = randomBytes(16);
      const hash = await scrypt(body.password, salt);
      const user: UserRecord = { id: randomUUID(), username, salt: salt.toString('base64'), hash: hash.toString('base64'), pv: 1, createdAt: Date.now() };
      const r = await store.put(userKey(username), enc.encode(JSON.stringify(user)), 'application/json', { mode: 'create' });
      if (r === 'exists') return err(409, 'username_taken', 'That username is taken.');
      return json(200, session(user, secret));
    }

    if (action === 'login' && method === 'POST') {
      const body = await readBody(req);
      const username = normUsername(body.username);
      const password = typeof body.password === 'string' ? body.password : '';
      const user = username ? await readUser(store, username) : null;
      const salt = user ? Buffer.from(user.salt, 'base64') : randomBytes(16);
      const hash = await scrypt(password, salt); // always hash: same timing for unknown users
      if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'base64'))) {
        await sleep(400);
        return err(401, 'bad_credentials', 'Wrong username or password.');
      }
      return json(200, session(user, secret));
    }

    if (action === 'me' && method === 'GET') {
      const user = await authenticate(req, store, secret);
      if (user instanceof Response) return user;
      return json(200, { user: { id: user.id, username: user.username, createdAt: user.createdAt } });
    }

    if (action === 'data' && method === 'GET') {
      const user = await authenticate(req, store, secret);
      if (user instanceof Response) return user;
      const inm = req.headers.get('if-none-match') ?? undefined;
      const o = await store.get(dataKey(user.id), inm);
      if (o === null) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
      if (o === 'not-modified') return new Response(null, { status: 304, headers: { etag: inm!, 'cache-control': 'no-store' } });
      return new Response(o.body.slice(), { // slice: an ArrayBuffer-backed copy, as Response expects
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'x-data-encoding': o.contentType === 'application/gzip' ? 'gzip' : 'identity', etag: o.etag, 'cache-control': 'no-store' },
      });
    }

    if (action === 'data' && method === 'PUT') {
      const user = await authenticate(req, store, secret);
      if (user instanceof Response) return user;
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0) return err(400, 'empty', 'No data sent.');
      if (buf.length > MAX_DATA_BYTES) return err(413, 'too_large', 'Your data is too large to sync.');
      const encoding = req.headers.get('x-data-encoding') === 'gzip' ? 'gzip' : 'identity';
      const ifMatch = req.headers.get('if-match') ?? undefined;
      const create = req.headers.get('if-none-match') === '*';
      const r = await store.put(dataKey(user.id), buf, encoding === 'gzip' ? 'application/gzip' : 'application/json', create ? { mode: 'create' } : { mode: 'overwrite', ifMatch });
      if (r === 'exists' || r === 'conflict') return err(412, 'conflict', 'Your data changed on another device. Syncing again.');
      return json(200, { etag: r.etag, savedAt: Date.now() });
    }

    if (action === 'password' && method === 'POST') {
      const user = await authenticate(req, store, secret);
      if (user instanceof Response) return user;
      const body = await readBody(req);
      const old = await scrypt(typeof body.oldPassword === 'string' ? body.oldPassword : '', Buffer.from(user.salt, 'base64'));
      if (!timingSafeEqual(old, Buffer.from(user.hash, 'base64'))) return err(401, 'bad_credentials', 'Your current password is wrong.');
      if (!validPassword(body.newPassword)) return err(400, 'bad_password', 'Passwords need at least 8 characters.');
      const salt = randomBytes(16);
      const next: UserRecord = { ...user, salt: salt.toString('base64'), hash: (await scrypt(body.newPassword, salt)).toString('base64'), pv: user.pv + 1 };
      await store.put(userKey(user.username), enc.encode(JSON.stringify(next)), 'application/json', { mode: 'overwrite' });
      return json(200, session(next, secret));
    }

    if (action === 'account' && method === 'DELETE') {
      const user = await authenticate(req, store, secret);
      if (user instanceof Response) return user;
      const body = await readBody(req);
      const check = await scrypt(typeof body.password === 'string' ? body.password : '', Buffer.from(user.salt, 'base64'));
      if (!timingSafeEqual(check, Buffer.from(user.hash, 'base64'))) return err(401, 'bad_credentials', 'Wrong password.');
      await store.delete(dataKey(user.id));
      await store.delete(userKey(user.username));
      return json(200, { deleted: true });
    }

    return err(404, 'not_found', 'Unknown request.');
  } catch (e) {
    console.error('api error', e);
    return err(500, 'server_error', 'Something went wrong on the server. Try again.');
  }
}

/** In-memory store for tests and local development. */
export function memoryStore(): Store & { keys(): string[] } {
  const m = new Map<string, StoredObject>();
  let n = 0;
  return {
    keys: () => [...m.keys()],
    async get(key, ifNoneMatch) {
      const o = m.get(key);
      if (!o) return null;
      if (ifNoneMatch && ifNoneMatch === o.etag) return 'not-modified';
      return o;
    },
    async put(key, body, contentType, opts) {
      const cur = m.get(key);
      if (opts.mode === 'create' && cur) return 'exists';
      if (opts.mode === 'overwrite' && opts.ifMatch && (!cur || cur.etag !== opts.ifMatch)) return 'conflict';
      const etag = `"m${++n}"`;
      m.set(key, { body: body.slice(), etag, contentType });
      return { etag };
    },
    async delete(key) { m.delete(key); },
  };
}
