import { handle, memoryStore } from './app';

const SECRET = 'test-secret';
const call = (store: ReturnType<typeof memoryStore>, a: string, init: RequestInit = {}) =>
  handle(new Request(`http://x/api/main?a=${a}`, init), store, SECRET);
const post = (store: ReturnType<typeof memoryStore>, a: string, body: unknown, token?: string) =>
  call(store, a, { method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('cloud api', () => {
  it('registers, rejects duplicates and bad input, logs in', async () => {
    const s = memoryStore();
    const r = await post(s, 'register', { username: 'Shark_1', password: 'correct horse' });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.user.username).toBe('shark_1');
    expect(j.token).toMatch(/^v1\./);
    expect((await post(s, 'register', { username: 'shark_1', password: 'another pass' })).status).toBe(409);
    expect((await post(s, 'register', { username: 'a', password: 'longenough' })).status).toBe(400);
    expect((await post(s, 'register', { username: 'okname', password: 'short' })).status).toBe(400);
    expect((await post(s, 'login', { username: 'shark_1', password: 'wrong password' })).status).toBe(401);
    expect((await post(s, 'login', { username: 'nobody', password: 'whatever1' })).status).toBe(401);
    const ok = await post(s, 'login', { username: 'SHARK_1', password: 'correct horse' });
    expect(ok.status).toBe(200);
    // the stored record never contains the password
    const raw = JSON.stringify(await s.get('users/shark_1.json').then((o) => (o && o !== 'not-modified' ? new TextDecoder().decode(o.body) : '')));
    expect(raw).not.toContain('correct horse');
  });

  it('syncs data with etags and detects conflicts', async () => {
    const s = memoryStore();
    const { token } = await (await post(s, 'register', { username: 'player', password: 'password123' })).json();
    const auth = { authorization: `Bearer ${token}` };
    expect((await call(s, 'data', { headers: auth })).status).toBe(204);
    expect((await call(s, 'data')).status).toBe(401);
    const put1 = await call(s, 'data', { method: 'PUT', body: '{"v":2}', headers: { ...auth, 'if-none-match': '*' } });
    expect(put1.status).toBe(200);
    const { etag } = await put1.json();
    // a second "create" from another device conflicts
    expect((await call(s, 'data', { method: 'PUT', body: '{"v":2,"x":1}', headers: { ...auth, 'if-none-match': '*' } })).status).toBe(412);
    const got = await call(s, 'data', { headers: auth });
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBe(etag);
    expect(await got.text()).toBe('{"v":2}');
    expect((await call(s, 'data', { headers: { ...auth, 'if-none-match': etag } })).status).toBe(304);
    const put2 = await call(s, 'data', { method: 'PUT', body: '{"v":2,"y":1}', headers: { ...auth, 'if-match': etag } });
    expect(put2.status).toBe(200);
    // stale etag conflicts
    expect((await call(s, 'data', { method: 'PUT', body: '{}', headers: { ...auth, 'if-match': etag } })).status).toBe(412);
  });

  it('rejects forged or stale tokens; password change ends old sessions; delete removes data', async () => {
    const s = memoryStore();
    const { token } = await (await post(s, 'register', { username: 'p22', password: 'password123' })).json();
    const forged = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect((await call(s, 'me', { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
    expect((await call(s, 'me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    const ch = await post(s, 'password', { oldPassword: 'password123', newPassword: 'newpassword9' }, token);
    expect(ch.status).toBe(200);
    const fresh = (await ch.json()).token;
    expect((await call(s, 'me', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await call(s, 'me', { headers: { authorization: `Bearer ${fresh}` } })).status).toBe(200);
    await call(s, 'data', { method: 'PUT', body: '{}', headers: { authorization: `Bearer ${fresh}`, 'if-none-match': '*' } });
    expect((await call(s, 'account', { method: 'DELETE', body: JSON.stringify({ password: 'wrong' }), headers: { authorization: `Bearer ${fresh}` } })).status).toBe(401);
    expect((await call(s, 'account', { method: 'DELETE', body: JSON.stringify({ password: 'newpassword9' }), headers: { authorization: `Bearer ${fresh}` } })).status).toBe(200);
    expect(s.keys()).toEqual([]);
  });
});
