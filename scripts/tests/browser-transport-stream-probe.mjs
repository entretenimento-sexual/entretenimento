// Synthetic loopback-only probe: response headers and partial-body lifecycle.
// Diagnostic evidence only; never changes the integrated certification gates.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cases = new Map();
const sockets = new Set();
let frontOrigin;
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Stream probe</title><body>Fixture</body></html>';
function listen(handler) {
  const server = http.createServer(handler);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({server, origin: 'http://127.0.0.1:'+server.address().port}));
  });
}
function respond(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/stream' || url.pathname === '/ok') {
    res.setHeader('Access-Control-Allow-Origin', frontOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-probe');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/ok') { res.writeHead(200); return res.end('ok'); }
    const entry = cases.get(url.searchParams.get('case'));
    if (!entry || req.method !== 'POST') { res.writeHead(400); return res.end(); }
    entry.res = res;
    res.on('close', () => { entry.closed = true; });
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.flushHeaders();
    // Large enough to avoid tiny-chunk buffering; ASCII permits exact byte checks.
    res.write('a'.repeat(32768));
    return;
  }
  if (url.pathname === '/denied') { res.writeHead(200); return res.end('denied'); }
  res.writeHead(200, {'Content-Type':'text/html'}); res.end(html);
}
async function until(label, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await sleep(50); }
  throw new Error('Timeout: ' + label);
}
const front = await listen(respond);
frontOrigin = front.origin;
const api = await listen(respond);
let browser;
const engine = process.argv[2];
const out = {engine, controls: [], cases: []};
try {
  if (engine === '--self-test') {
    const token = 'self-test'; const entry = {closed:false}; cases.set(token, entry);
    const preflight = await fetch(api.origin+'/stream?case='+token, {method:'OPTIONS',headers:{Origin:frontOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-probe'}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),frontOrigin);
    const response = await fetch(api.origin+'/stream?case='+token,{method:'POST',body:'{}',headers:{Origin:frontOrigin,'Content-Type':'application/json','X-Probe':'1'}});
    assert.equal(response.status,200);
    const reader = response.body.getReader();
    const first = await reader.read(); assert.ok(!first.done && first.value.length>0);
    entry.res.end('tail');
    let total = first.value.length;
    for (;;) { const chunk = await reader.read(); if(chunk.done) break; total+=chunk.value.length; }
    assert.equal(total,32772);
    console.log('PASS synthetic server preflight, headers, partial body and completion');
  } else {
    assert.ok(['chromium','firefox','webkit'].includes(engine), 'Expected browser engine');
    const types = await import('playwright');
    browser = await types[engine].launch({headless:true});
    out.version = browser.version();
    for (const routed of [false,true]) {
      const context = await browser.newContext({serviceWorkers:'block'});
      let offline = false;
      try {
        if (routed) await context.route('**/*', route => {
          const origin = new URL(route.request().url()).origin;
          if (![front.origin,api.origin].includes(origin)) return route.abort();
          return offline ? route.abort('internetdisconnected') : route.continue();
        });
        const control = await context.newPage();
        await control.goto(front.origin);
        const allowed = await control.evaluate(async url => { const r=await fetch(url); return [r.status,await r.text()]; },api.origin+'/ok');
        const denied = await control.evaluate(async url => {try {await fetch(url);return false;}catch{return true;}},api.origin+'/denied');
        assert.deepEqual(allowed,[200,'ok']); assert.equal(denied,true);
        out.controls.push({routed,allowed:allowed[0],denied}); await control.close();
        for (const transport of ['fetch','xhr']) for (const action of ['complete','abort','navigate','offline-reconnect']) {
          const token=[routed,transport,action].join('-');
          const result={routed,transport,action,events:[],nativeErrors:[],pageErrors:[],network:[]}; out.cases.push(result);
          const entry={closed:false}; cases.set(token,entry);
          const page=await context.newPage(); const url=api.origin+'/stream?case='+token;
          const started=performance.now();
          const record=(target,detail)=>target.push({atMs:Math.round(performance.now()-started),...detail});
          try {
            await page.exposeBinding('reportStreamProbe',(_,kind,detail)=>record(kind==='native'?result.nativeErrors:result.events,{kind,detail}));
            await page.addInitScript(()=>{
              const report=(kind,detail)=>{void globalThis.reportStreamProbe(kind,detail).catch(()=>{});};
              addEventListener('error',e=>{if(e instanceof ErrorEvent)report('native','error');},true);
              addEventListener('unhandledrejection',()=>report('native','unhandledrejection'));
            });
            page.on('pageerror',e=>record(result.pageErrors,{message:String(e.message)}));
            page.on('request',r=>{if(r.url()===url)record(result.network,{event:'start',method:r.method()});});
            page.on('response',r=>{if(r.url()===url)record(result.network,{event:'headers',method:r.request().method(),status:r.status()});});
            page.on('requestfinished',r=>{if(r.url()===url)record(result.network,{event:'finished',method:r.method()});});
            page.on('requestfailed',r=>{if(r.url()===url)record(result.network,{event:'failed',method:r.method(),reason:r.failure()?.errorText??'unknown'});});
            await page.goto(front.origin);
            await page.evaluate(({url,transport})=>{
              const report=(kind,detail)=>{void globalThis.reportStreamProbe(kind,detail).catch(()=>{});};
              if(transport==='fetch') {
                const controller=new AbortController(); globalThis.abortStreamProbe=()=>controller.abort();
                void (async()=>{
                  try {
                    const r=await fetch(url,{method:'POST',body:'{}',headers:{'Content-Type':'application/json','X-Probe':'1'},signal:controller.signal});
                    report('headers',r.status); const reader=r.body.getReader(); let total=0;
                    for(;;){const chunk=await reader.read();if(chunk.done)break;if(!total)report('partial',chunk.value.length);total+=chunk.value.length;}
                    report('complete',total);
                  } catch(e) { report('rejected',e.name); }
                })();
              } else {
                const xhr=new XMLHttpRequest(); xhr.open('POST',url);
                xhr.setRequestHeader('Content-Type','application/json');xhr.setRequestHeader('X-Probe','1');
                xhr.onreadystatechange=()=>{if(xhr.readyState===2)report('headers',xhr.status);};
                let partial=false;
                xhr.onprogress=e=>{if(!partial&&e.loaded>0){partial=true;report('partial',e.loaded);}};
                xhr.onload=()=>report('complete',xhr.responseText.length);
                xhr.onerror=()=>report('rejected','xhr-error');xhr.onabort=()=>report('rejected','xhr-abort');
                globalThis.abortStreamProbe=()=>xhr.abort();xhr.send('{}');
              }
            },{url,transport});
            // A real browser-observed partial body is mandatory before interruption.
            await until(token+' partial response',()=>result.events.some(e=>e.kind==='headers'&&e.detail===200)&&result.events.some(e=>e.kind==='partial'&&e.detail>0));
            assert.ok(entry.res,'Server did not receive POST');
            if(action==='complete') {
              entry.res.end('tail');
              await until(token+' completion',()=>result.events.some(e=>e.kind==='complete'&&e.detail===32772));
            } else if(action==='abort') {
              await page.evaluate(()=>globalThis.abortStreamProbe());
              await until(token+' abort',()=>result.events.some(e=>e.kind==='rejected'&&e.detail===(transport==='fetch'?'AbortError':'xhr-abort')));
              assert.ok(!result.events.some(e=>e.kind==='complete'));
            } else if(action==='navigate') {
              await page.goto(front.origin+'/next');
              assert.equal(new URL(page.url()).pathname,'/next');
            } else {
              offline=true; await context.setOffline(true);
              assert.equal(await page.evaluate(()=>navigator.onLine),false);
              const rejected=await page.evaluate(async u=>{try{await fetch(u);return false;}catch{return true;}},api.origin+'/ok');
              assert.equal(rejected,true,'Offline negative control');
              await sleep(350);
              offline=false; await context.setOffline(false);
              const recovered=await page.evaluate(async u=>{const r=await fetch(u);return [r.status,await r.text()];},api.origin+'/ok');
              assert.deepEqual(recovered,[200,'ok']);
              // Some engines retain an existing stream across offline transitions.
              // Record the observed outcome, then clean up deterministically.
              result.beforeCleanup=result.events.map(e=>({...e}));
              if(!result.events.some(e=>e.kind==='rejected'||e.kind==='complete'))await page.evaluate(()=>globalThis.abortStreamProbe());
            }
            await sleep(350);
            result.serverClosed=entry.closed;
          } finally {
            offline=false; await context.setOffline(false).catch(()=>{});
            if(entry.res&&!entry.res.destroyed&&!entry.res.writableEnded)entry.res.end();
            cases.delete(token); await page.close();
          }
        }
      } finally {await context.close();}
    }
    assert.equal(out.cases.length,16);
    assert.equal(out.controls.length,2);
  }
} catch(error) {out.error=String(error);process.exitCode=1;}
finally {
  await browser?.close();
  for(const socket of sockets)socket.destroy();
  await Promise.all([front.server,api.server].map(s=>new Promise(resolve=>s.close(resolve))));
  if(engine!=='--self-test') {
    await mkdir('artifacts/browser-transport-probe',{recursive:true});
    await writeFile('artifacts/browser-transport-probe/stream-'+engine+'.json',JSON.stringify(out,null,2));
    console.log(JSON.stringify(out));
  } else if(out.error) console.error(out.error);
}
