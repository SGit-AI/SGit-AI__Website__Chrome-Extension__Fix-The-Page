// A tiny static server for the fixtures. Every path that is not a fixture file serves spa.html, so a
// single-page app can be loaded at /a/1 directly. Listens on 127.0.0.1 and a free port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = path.join(FIXTURES, url.pathname.replace(/^\//, ''));
    if (!url.pathname.endsWith('.html') || !fs.existsSync(file)) file = path.join(FIXTURES, 'spa.html');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
