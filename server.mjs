import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://' + (request.headers.host || 'localhost'));
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname).replace(/\\/g, '/');
    const filePath = resolve(root, '.' + requested);
    const relativePath = relative(root, filePath);
    if (relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (relativePath.split(sep).some((part) => part === '.git' || part === 'node_modules' || part === '.env')) {
      response.writeHead(404).end('Not found');
      return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Pace is ready at http://127.0.0.1:' + port);
});
