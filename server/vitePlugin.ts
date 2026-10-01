/** Serves /api/main from the Vite dev and preview servers, backed by files in .data/. */
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './app';
import { fileStore } from './fileStore';

export function localApi(): Plugin {
  const store = fileStore(new URL('../.data', import.meta.url).pathname);
  const secret = process.env.AUTH_SECRET ?? 'local-development-secret';
  const middleware: Connect.NextHandleFunction = async (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith('/api/main')) return next();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const method = req.method ?? 'GET';
    const request = new Request(`http://localhost${req.url}`, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks) });
    const response = await handle(request, store, secret);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'mtt-local-api',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
