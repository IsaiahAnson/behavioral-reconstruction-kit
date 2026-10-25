import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function startDemoServer({ port = 0, increment = 1 } = {}) {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Counter fixture</title>
<body><span id="count"></span><button id="add">Add</button>
<script>
const count = document.querySelector('#count');
count.textContent = localStorage.getItem('count') ?? '0';
document.querySelector('#add').addEventListener('click', () => {
  const next = Number(count.textContent) + ${increment};
  count.textContent = String(next);
  localStorage.setItem('count', String(next));
});
</script></body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] ?? 4179);
  const increment = Number(process.argv[3] ?? 1);
  const { baseUrl } = await startDemoServer({ port, increment });
  process.stdout.write(`${baseUrl}\n`);
}
