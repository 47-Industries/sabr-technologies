const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif',
  '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json'
};
const ROOT = __dirname;

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  // prevent path traversal
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA/anchor fallback: serve index.html for unknown non-asset routes
      if (!path.extname(filePath)) {
        return fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
          res.end(idx);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = (ext === '.html' || ext === '')
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    res.end(data);
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Sabr Technologies live on port', PORT));
