import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
if (process.argv.includes('--review')) process.env.LOCAL_REVIEW = '1';
const { default: api } = await import('../api/index.js');
const root = resolve('public');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf' };
const server = createServer(async (req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) return api(req,res);
  try {
    let file = resolve(root, '.' + decodeURIComponent(path));
    if (file !== root && !file.startsWith(root + sep)) throw Error();
    if (path === '/') file = resolve(root, 'index.html');
    else if (!extname(path)) file += '.html';
    if (!(await stat(file)).isFile()) throw Error();
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404);res.end('Página não encontrada'); }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${process.env.PORT || 4173}${process.env.LOCAL_REVIEW ? ' (revisão sem cobranças reais)' : ''}`));
