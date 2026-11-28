import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.CI,'true');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:19099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18080');
assert.equal(process.env.GCLOUD_PROJECT??process.env.GCP_PROJECT,'demo-firebase-webchannel-probe');
const engine=process.argv[2];
assert.ok(['chromium','firefox','webkit'].includes(engine));
const require=createRequire(import.meta.url);
// Vite's locked esbuild dependency, resolved from its installation.
const viteRequire=createRequire(require.resolve('vite/package.json'));
const {build}=viteRequire('esbuild');
const bundle=await build({entryPoints:['scripts/tests/firebase-webchannel-probe-client.mjs'],
  bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
const payload=bundle.outputFiles[0].text;
const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Firebase probe</title><script type="module" src="/client.js"></script></html>';
const blank='<!doctype html><html lang="en"><meta charset="utf-8"><title>Replacement</title></html>';
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/client.js'){res.setHeader('Content-Type','text/javascript');return res.end(payload);}
  res.setHeader('Content-Type','text/html');
  res.end(path==='/next'?blank:html);
});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const origin='http://127.0.0.1:'+server.address().port;
const allowed=new Set([origin,'http://127.0.0.1:19099','http://127.0.0.1:18080']);
const endpoint=url=>{
  const u=new URL(url);
  if(u.origin!=='http://127.0.0.1:18080')return null;
  if(u.pathname.endsWith('/Listen/channel'))return 'Listen';
  if(u.pathname.endsWith('/Write/channel'))return 'Write';
  return null;
};
const failure=reason=>['Load request cancelled','net::ERR_ABORTED','NS_BINDING_ABORTED'].includes(reason)
  ?reason:'other';
const out={engine,cases:[]};
const dir=resolve('artifacts/firebase-webchannel-probe');
await mkdir(dir,{recursive:true});
let browser;
try {
  const types=await import(pathToFileURL(resolve(process.env.CHAT_BROWSER_PLAYWRIGHT)).href);
  browser=await types[engine].launch({headless:true});
  out.version=browser.version();
  for(const polling of ['default','forced'])for(const action of ['graceful','abrupt','unsubscribe-only','drain-only']){
    const context=await browser.newContext({serviceWorkers:'block'});
    const result={polling,action,network:[],pageErrors:[],nativeErrors:[],blockedExternal:0,blockedRequests:[]};
    out.cases.push(result);
    await context.route('**/*',route=>{
      const request=route.request(),url=new URL(request.url());
      if(!allowed.has(url.origin)){
        result.blockedExternal++;
        // Keep unknown origin identifiers runner-local and non-reversible in
        // the artifact; disclose only known public service hostnames.
        const known=['www.gstatic.com','apis.google.com','accounts.google.com','www.googleapis.com',
          'identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com'];
        result.blockedRequests.push({scheme:url.protocol,host:known.includes(url.hostname)
          ?url.hostname:'other',originDigest:createHash('sha256').update(url.origin).digest('hex').slice(0,16),
          resourceType:request.resourceType()});
        return route.abort();
      }
      return route.continue();
    });
    const page=await context.newPage();
    const handles=new Map();
    const time=()=>Math.round(performance.now());
    try{
      await page.exposeBinding('probeRuntimeError',(_,kind)=>{
        if(['error','unhandledrejection'].includes(kind))result.nativeErrors.push({kind,atMs:time()});
      });
      await page.addInitScript(()=>{
        const report=kind=>{void globalThis.probeRuntimeError(kind).catch(()=>{});};
        addEventListener('error',e=>{if(e instanceof ErrorEvent)report('error');},true);
        addEventListener('unhandledrejection',()=>report('unhandledrejection'));
      });
      page.on('pageerror',error=>{
        // Never serialize raw URLs, tokens, request bodies or user identifiers.
        const m=String(error.message);
        result.pageErrors.push({atMs:time(),channel:m.includes('/Listen/channel')?'Listen':
          m.includes('/Write/channel')?'Write':'other',
          accessControl:/due to access control checks/i.test(m)});
      });
      page.on('request',r=>{const channel=endpoint(r.url());if(channel){
        const row={channel,method:r.method(),startMs:time(),status:null,terminal:null};
        handles.set(r,row);result.network.push(row);
      }});
      page.on('response',r=>{const row=handles.get(r.request());if(row)row.status=r.status();});
      page.on('requestfinished',r=>{const row=handles.get(r);if(row){row.terminal='finished';row.endMs=time();}});
      page.on('requestfailed',r=>{const row=handles.get(r);if(row){
        row.terminal='failed';row.endMs=time();row.failure=failure(r.failure()?.errorText);
      }});
      await page.goto(origin+'/?polling='+polling);
      await page.waitForFunction(()=>globalThis.probeState?.ready&&globalThis.probeState.serverSnapshot,
        null,{timeout:30_000});
      result.controls=await page.evaluate(()=>({...globalThis.probeState}));
      assert.equal(result.controls.denied,true);
      assert.deepEqual(result.controls.sdkErrors,[]);
      assert.ok(result.network.some(row=>row.channel==='Listen'),'Listen transport not observed');
      const write=page.waitForRequest(r=>endpoint(r.url())==='Write'&&r.method()==='POST',{timeout:15_000});
      await Promise.all([write,page.evaluate(()=>{globalThis.startProbeWrite();})]);
      if(action==='graceful'){
        await page.evaluate(()=>globalThis.stopProbe());
        await page.waitForFunction(()=>globalThis.probeState.cleanup&&globalThis.probeState.writeAck);
      } else if(action==='unsubscribe-only'){
        await page.evaluate(()=>globalThis.unsubscribeProbe());
      } else if(action==='drain-only'){
        await page.evaluate(()=>globalThis.drainProbe());
        await page.waitForFunction(()=>globalThis.probeState.writeAck);
      }
      result.beforeNavigation=await page.evaluate(()=>({...globalThis.probeState}));
      result.activeBeforeNavigation=result.network.filter(row=>row.terminal===null).map(row=>row.channel);
      result.navigationMs=time();
      await page.goto(origin+'/next');
      assert.equal(new URL(page.url()).pathname,'/next');
      await page.waitForTimeout(600);
    }catch(error){
      result.failed=true;
      // Only a bounded error class; no potentially credential-bearing message.
      result.errorKind=error?.name??'Error';
    }finally{
      await context.close();
    }
    console.log('Firebase webchannel case '+JSON.stringify({
      polling,action,failed:!!result.failed,blockedExternal:result.blockedExternal,
      activeBeforeNavigation:result.activeBeforeNavigation??[],
      writeAckBeforeNavigation:result.beforeNavigation?.writeAck??null,
      blockedRequests:result.blockedRequests,pageErrors:result.pageErrors.length,nativeErrors:result.nativeErrors.length
    }));
  }
  assert.equal(out.cases.length,8);
  assert.ok(out.cases.every(c=>!c.failed&&c.blockedExternal===0),'Probe controls failed');
  assert.ok(out.cases.every(c=>c.pageErrors.length===0&&c.nativeErrors.length===0),
    'Observed runtime error; inspect diagnostic evidence');
}catch(error){out.failed=true;console.error(error.name+': Firebase webchannel probe failed');process.exitCode=1;}
finally{
  await browser?.close();
  server.closeAllConnections();
  await new Promise(ok=>server.close(ok));
  await writeFile(resolve(dir,engine+'.json'),JSON.stringify(out,null,2));
}
