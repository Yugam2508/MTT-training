/** File-system Store for local development (`npm run dev` / `npm run preview`). */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { Store } from './app';

export function fileStore(root: string): Store {
  const pathOf = (key: string) => {
    const p = normalize(join(root, key));
    if (!p.startsWith(normalize(root))) throw new Error('bad key');
    return p;
  };
  const readMeta = async (p: string) => {
    try { return JSON.parse(await readFile(`${p}.meta`, 'utf8')) as { etag: string; contentType: string }; } catch { return null; }
  };
  return {
    async get(key, ifNoneMatch) {
      const p = pathOf(key);
      const meta = await readMeta(p);
      if (!meta) return null;
      if (ifNoneMatch && ifNoneMatch === meta.etag) return 'not-modified';
      return { body: new Uint8Array(await readFile(p)), etag: meta.etag, contentType: meta.contentType };
    },
    async put(key, body, contentType, opts) {
      const p = pathOf(key);
      const meta = await readMeta(p);
      if (opts.mode === 'create' && meta) return 'exists';
      if (opts.mode === 'overwrite' && opts.ifMatch && (!meta || meta.etag !== opts.ifMatch)) return 'conflict';
      const etag = `"${createHash('sha1').update(body).update(String(Date.now())).digest('hex').slice(0, 16)}"`;
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
      await writeFile(`${p}.meta`, JSON.stringify({ etag, contentType }));
      return { etag };
    },
    async delete(key) {
      const p = pathOf(key);
      await rm(p, { force: true });
      await rm(`${p}.meta`, { force: true });
    },
  };
}
