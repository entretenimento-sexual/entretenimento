// Browser-only shared-storage diagnostic. No Firebase, user data or production endpoints.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const engine=process.argv[2];
assert.ok(['chromium','firefox','webkit'].includes(engine));
const server=http.createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
  res.end('<!doctype html><html lang="en"><title>Ledger probe</title><body>Fixture</body></html>');
});
await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
const origin='http://127.0.0.1:'+server.address().port;
const dir=resolve('artifacts/firebase-webchannel-probe');
await mkdir(dir,{recursive:true});
const result={engine,cases:[]};
let browser;
try{
  const types=await import(pathToFileURL(resolve(process.env.CHAT_BROWSER_PLAYWRIGHT)).href);
  browser=await types[engine].launch({headless:true});
  for(const reload of [false,true]){
    const context=await browser.newContext({serviceWorkers:'block'});
    const independent=await browser.newContext({serviceWorkers:'block'});
    const row={reload,rounds:[],blockedExternal:0};
    result.cases.push(row);
    try{
      for(const ctx of [context,independent])await ctx.route('**/*',route=>{
        if(new URL(route.request().url()).origin!==origin){
          row.blockedExternal++;return route.abort();
        }
        return route.continue();
      });
      const [a,b,c]=await Promise.all([context.newPage(),context.newPage(),independent.newPage()]);
      await Promise.all([a,b,c].map(page=>page.goto(origin)));
      for(let round=0;round<12;round++){
        const key='fixture-ledger-'+round;
        const read=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key);
        // Read and write inside exactly one Web Lock, as in the app.
        const reserve=(page,ids)=>page.evaluate(async ({key,ids})=>{
          if(!navigator.locks)throw Error('Web Locks unavailable');
          return Promise.all(ids.map(id=>navigator.locks.request('fixture-quota',()=>{
            const values=JSON.parse(localStorage.getItem(key)??'[]');
            const before=values.length;
            const admitted=before<10;
            if(admitted)localStorage.setItem(key,JSON.stringify([...values,id]));
            return {id,before,admitted};
          })));
        },{key,ids});
        const initial=await reserve(a,['seed-0','seed-1','seed-2','seed-3']);
        if(reload)await b.reload();
        // Require visibility across pages before contention.
        const seedSeen=await read(b);
        const [left,right,isolated]=await Promise.all([
          reserve(a,Array.from({length:8},(_,i)=>'a-'+i)),
          reserve(b,Array.from({length:8},(_,i)=>'b-'+i)),
          reserve(c,['independent'])
        ]);
        const [aFinal,bFinal,cFinal]=await Promise.all([read(a),read(b),read(c)]);
        const accepted=[...initial,...left,...right].filter(v=>v.admitted);
        const expected=accepted.map(v=>v.id).sort();
        const pass=seedSeen.length===4&&accepted.length===10&&
          new Set(accepted.map(v=>v.before)).size===10&&
          JSON.stringify([...aFinal].sort())===JSON.stringify(expected)&&
          JSON.stringify([...bFinal].sort())===JSON.stringify(expected)&&
          isolated[0].admitted&&isolated[0].before===0&&
          JSON.stringify(cFinal)==='["independent"]';
        row.rounds.push({round,pass,seedCount:seedSeen.length,accepted:accepted.length,
          acceptedOrdinals:accepted.map(v=>v.before),aFinal:aFinal.length,bFinal:bFinal.length,
          isolatedFinal:cFinal.length});
      }
    }catch(error){row.errorKind=error?.name??'Error';}
    finally{await Promise.allSettled([context.close(),independent.close()]);}
    console.log('Shared ledger probe '+JSON.stringify({reload,rounds:row.rounds.length,
      passed:row.rounds.filter(x=>x.pass).length,blockedExternal:row.blockedExternal,errorKind:row.errorKind??null}));
  }
  assert.equal(result.cases.length,2);
  assert.ok(result.cases.every(x=>!x.errorKind&&x.blockedExternal===0&&x.rounds.length===12&&x.rounds.every(r=>r.pass)),
    'Shared storage invariant failed');
}catch(error){result.failed=true;console.error(error.name+': shared ledger probe failed');process.exitCode=1;}
finally{
  await browser?.close();
  server.closeAllConnections();
  await new Promise(ok=>server.close(ok));
  await writeFile(resolve(dir,'ledger-'+engine+'.json'),JSON.stringify(result,null,2));
}
