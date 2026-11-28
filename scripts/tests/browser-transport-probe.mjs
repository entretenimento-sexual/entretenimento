// Isolated transport reproduction. No Firebase, user data, or external endpoints.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';

const engine = process.argv[2];
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const types = { chromium, firefox, webkit };
const out = { engine, cases: [], controls: [] };
let frontOrigin;
const pending = new Map();
const sockets = new Set();
const listen = async handler => {
  const server = http.createServer(handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
};
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Transport probe</title><body>Fixture</body></html>';
const respond = (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/probe/ok' || url.pathname === '/probe/denied' || url.pathname === '/probe/slow') {
    if (url.pathname !== '/probe/denied') res.setHeader('Access-Control-Allow-Origin', frontOrigin);
    res.setHeader('Content-Type', 'text/plain');
    if (url.pathname !== '/probe/slow') return res.end('ok');
    const token = url.searchParams.get('case');
    const entry = pending.get(token);
    if (!entry) { res.statusCode = 400; return res.end('unknown case'); }
    entry.res = res;
    entry.received();
    res.on('close', () => { entry.closed = true; });
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(html);
};
const front = await listen(respond);
frontOrigin = front.origin;
const api = await listen(respond);
let browser;
try {
  browser = await types[engine].launch({ headless: true });
  out.version = browser.version();
  for (const routed of [false, true]) {
    const context = await browser.newContext();
    try {
      if (routed) await context.route('**/*', route => {
        const u = new URL(route.request().url());
        return [front.origin, api.origin].includes(u.origin) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.goto(front.origin);
      const good = await page.evaluate(async url => {
        const r = await fetch(url);
        return [r.status, await r.text()];
      }, api.origin + '/probe/ok');
      assert.deepEqual(good, [200, 'ok']);
      const denied = await page.evaluate(async url => {
        try { await fetch(url); return false; } catch { return true; }
      }, api.origin + '/probe/denied');
      assert.equal(denied, true, 'CORS negative control must be rejected');
      out.controls.push({ routed, allowed: good[0], denied });
      await page.close();
      for (const crossOrigin of [false, true]) {
        for (const navigate of [false, true]) {
          for (const transport of ['fetch', 'xhr']) {
            const token = [routed, crossOrigin, navigate, transport].join('-');
            const result = { routed, crossOrigin, navigate, transport, pageErrors: [], nativeErrors: [], failures: [], responses: [], outcome: [] };
            out.cases.push(result);
            const probe = await context.newPage();
            try {
              await probe.exposeBinding('reportProbeEvent', (_, type, detail) => {
                if (type === 'native') result.nativeErrors.push(detail);
                else result.outcome.push(detail);
              });
              await probe.addInitScript(() => {
                addEventListener('error', e => {
                  if (e instanceof ErrorEvent) void globalThis.reportProbeEvent('native', String(e.message));
                });
                addEventListener('unhandledrejection', e => {
                  void globalThis.reportProbeEvent('native', String(e.reason));
                });
              });
              probe.on('pageerror', e => result.pageErrors.push(e.message));
              const url = (crossOrigin ? api.origin : front.origin) + '/probe/slow?case=' + token;
              probe.on('requestfailed', r => {
                if (r.url() === url) result.failures.push(r.failure()?.errorText ?? 'unknown');
              });
              probe.on('response', r => {
                if (r.url() === url) result.responses.push(r.status());
              });
              await probe.goto(front.origin);
              let received;
              const arrival = new Promise(resolve => { received = resolve; });
              const entry = { received, res: undefined, closed: false };
              pending.set(token, entry);
              await probe.evaluate(({ url, transport }) => {
                const report = detail => { void globalThis.reportProbeEvent('outcome', detail); };
                if (transport === 'fetch') {
                  void fetch(url).then(async r => report('success:' + r.status + ':' + await r.text()), () => report('fetch-rejected'));
                } else {
                  const xhr = new XMLHttpRequest();
                  xhr.open('GET', url);
                  xhr.onload = () => report('success:' + xhr.status + ':' + xhr.responseText);
                  xhr.onerror = () => report('xhr-error');
                  xhr.onabort = () => report('xhr-abort');
                  xhr.send();
                }
              }, { url, transport });
              let timer;
              try {
                await Promise.race([arrival, new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error('request not received: ' + token)), 10000);
                })]);
              } finally { clearTimeout(timer); }
              if (navigate) await probe.goto(front.origin + '/next');
              if (!entry.res.destroyed) entry.res.end('ok');
              if (!navigate) {
                const deadline = Date.now() + 5000;
                while (!result.outcome.length && Date.now() < deadline) {
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                assert.ok(result.outcome.includes('success:200:ok'), 'non-navigation control failed: ' + token);
              }
              await new Promise(resolve => setTimeout(resolve, 350));
              result.serverClosed = entry.closed;
              pending.delete(token);
            } finally { await probe.close(); }
          }
        }
      }
    } finally { await context.close(); }
  }
  assert.equal(out.cases.length, 16);
} catch (error) {
  out.error = String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const socket of sockets) socket.destroy();
  await Promise.all([front.server, api.server].map(server => new Promise(resolve => server.close(resolve))));
  await mkdir('artifacts/browser-transport-probe', { recursive: true });
  await writeFile('artifacts/browser-transport-probe/' + engine + '.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out));
}
