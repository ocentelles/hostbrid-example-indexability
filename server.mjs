import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
export const sentence = 'Texto sintético visible para comparar HTML y JavaScript.';
const js = `document.querySelector('#content').textContent=['Texto','sintético','visible','para','comparar','HTML','y','JavaScript.'].join(' ');`;
const routes = {
  '/static': { label: 'HTML inicial', content: sentence },
  '/javascript': { label: 'Contenido añadido con JavaScript', script: js },
  '/meta-noindex': { label: 'Meta noindex', content: sentence, meta: true },
  '/header-noindex': { label: 'Cabecera noindex', content: sentence, header: true },
  '/remove-noindex': { label: 'JavaScript elimina el noindex inicial', meta: true, script: js + `document.querySelector('meta[name="robots"]').remove();` },
  '/missing': { label: 'Ruta ausente: 404 real', content: 'Recurso ficticio inexistente.', status: 404 },
};
export function createFixture() {
  return createServer((request, response) => {
    const route = routes[new URL(request.url, 'http://127.0.0.1').pathname] || routes['/missing'];
    response.writeHead(route.status || 200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store', ...(route.header ? {'X-Robots-Tag':'noindex'} : {})});
    response.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${route.meta ? '<meta name="robots" content="noindex">' : ''}<title>${route.label}</title><style>body{font:18px/1.6 system-ui;margin:0;background:#f8fafc;color:#172033}main{max-width:720px;padding:28px;margin:auto}h1{font-size:28px;line-height:1.2}p{overflow-wrap:anywhere}</style></head><body><main><h1>${route.label}</h1><p id="content">${route.content || ''}</p><p>Ensayo local ficticio. Ver una página no demuestra su indexación.</p></main>${route.script ? `<script>${route.script}</script>` : ''}</body></html>`);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFixture();
  server.listen(0, '127.0.0.1', () => console.log(`Fixture local: http://127.0.0.1:${server.address().port}`));
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
