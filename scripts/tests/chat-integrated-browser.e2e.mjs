import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { seedPublicMediaCompliance } from './media-e2e-compliance-fixture.mjs';

const PROJECT = 'demo-entretenimento-media-e2e';
const BASE = 'http://127.0.0.1:4200';
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, '127.0.0.1:19199');
assert.equal(process.env.FIREBASE_EMULATOR_HUB, '127.0.0.1:14410');
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? PROJECT, PROJECT);
process.env.GCLOUD_PROJECT = PROJECT;
process.env.GCP_PROJECT = PROJECT;
const out = resolve(process.env.CHAT_BROWSER_ARTIFACTS ?? 'artifacts/chat-browser');
mkdirSync(out, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(process.env.CHAT_BROWSER_PLAYWRIGHT)).href);
const id = randomUUID().replaceAll('-', '').slice(0, 12);
const password = 'Emulator-Only-123Aa!';
const uid = key => 'chat-browser-' + key + '-' + id;
const [aUid,bUid,cUid] = ['a','b','c'].map(uid);
const email = user => user + '@example.test';
const admin = initializeAdminApp({ projectId: PROJECT, storageBucket: PROJECT + '.appspot.com' }, 'browser-admin');
const db = getAdminFirestore(admin);
const adminAuth = getAdminAuth(admin);
const sdk = initializeApp({projectId: PROJECT,apiKey:'fake-api-key',authDomain:'localhost'},'browser-control');
const auth = getAuth(sdk);
connectAuthEmulator(auth, 'http://127.0.0.1:19099', {disableWarnings:true});
const functions = getFunctions(sdk, 'us-central1');
connectFunctionsEmulator(functions,'127.0.0.1',15001);
const log = createWriteStream(resolve(out,'angular.log'));
let server, browser;
const pages = [];
const browserErrors = [];
const phases = [];
const sleep = ms => new Promise(r => setTimeout(r,ms));
async function until(label, read, accepts, timeout=60_000) {
  const end = Date.now()+timeout;
  while (Date.now()<end) {
    const value = await read();
    if (accepts(value)) return value;
    await sleep(200);
  }
  throw new Error('Timeout: ' + label);
}
function pass(phase) {
  phases.push(phase);
  console.log('PASS ' + phase);
}
async function newPage(name, viewport={width:1440,height:1000}) {
  const context = await browser.newContext({viewport,serviceWorkers:'block'});
  // Browser traffic cannot reach a cloud Firebase service or external provider.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', error => browserErrors.push({name,type:'pageerror',message:error.message}));
  page.on('console', message => {
    if (message.type()==='error' || message.type()==='warning') {
      browserErrors.push({name,type:message.type(),message:message.text().slice(0,600)});
    }
  });
  pages.push({name,page});
  return page;
}
async function login(page,user) {
  await page.goto(BASE+'/login');
  await page.locator('#email').fill(email(user));
  await page.locator('#password').fill(password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL(url => url.pathname !== '/login', {timeout:60_000});
}
async function logout(page) {
  const menu = page.locator('.account-menu__summary');
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button',{name:'Sair',exact:true}).filter({visible:true}).click();
  await page.locator('#email').waitFor({state:'visible'});
}
const composer = page => page.locator('.chat-shell__composer-main textarea');
const send = page => page.getByRole('button',{name:'Enviar',exact:true});
const message = (page, text) => page.locator('app-chat-message').getByText(text,{exact:true});
async function ready(page) {
  await composer(page).waitFor({state:'visible'});
  await until('composer writable', () => composer(page).getAttribute('aria-readonly'), value=>value==='false');
}
async function openChat(page, chatId) {
  await page.goto(BASE+'/chat?openChatId='+encodeURIComponent(chatId));
  await ready(page);
}
async function screenshot(page,name) {
  await page.screenshot({path:resolve(out,name+'.png')});
}
try {
  for (const user of [aUid,bUid,cUid]) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    // Wait for the real registration trigger, then materialize a completed
    // synthetic account using the shared compliance fixture.
    await until('registration seed',()=>db.doc('users/'+user).get(),s=>s.exists);
  }
  await seedPublicMediaCompliance(db,[aUid,bUid,cUid]);
  for (const [user,nickname] of [[aUid,'Browser Pessoa A'],[bUid,'Browser Pessoa B'],[cUid,'Browser Pessoa C']]) {
    const profile = {uid:user, nickname, nicknameNormalized:nickname.toLowerCase(),
      gender:'mulher',identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',
      role:'free',municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
  }
  await Promise.all([
    db.doc('users/'+aUid+'/friends/'+bUid).set({accepted:true}),
    db.doc('users/'+bUid+'/friends/'+aUid).set({accepted:true}),
  ]);
  await signInWithEmailAndPassword(auth,email(bUid),password);
  const chatId = (await httpsCallable(functions,'ensureDirectChat')({otherUserUid:aUid})).data.chatId;
  assert.ok(chatId);
  const notificationTitle='Browser Chat notification '+id;
  const notice = db.doc('notifications/browser-'+id);
  await notice.set({userId:aUid,type:'chat',title:notificationTitle,body:'Synthetic browser navigation',
    route:'/chat?openChatId='+encodeURIComponent(chatId),createdAt:new Date(),updatedAt:new Date(),readAt:null,read:false});
  server = spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--configuration=dev-emu','--host=127.0.0.1','--port=4200'],{stdio:['ignore','pipe','pipe']});
  server.stdout.pipe(log,{end:false});
  server.stderr.pipe(log,{end:false});
  await until('Angular HTTP',async()=>{
    if(server.exitCode!==null) throw new Error('Angular exited: '+server.exitCode);
    try {return (await fetch(BASE+'/login')).ok;} catch {return false;}
  },Boolean,180_000);
  browser = await chromium.launch({headless:true});
  const a = await newPage('a');
  const b = await newPage('b');
  await Promise.all([login(a,aUid),login(b,bUid)]);
  // A enters through the actual notification UI; B opens the canonical route.
  await a.goto(BASE+'/notificacoes');
  await a.getByRole('button',{name:'Abrir notificação: '+notificationTitle,exact:true}).click();
  await ready(a);
  await openChat(b,chatId);
  pass('independent real Angular login and notification deep link');
  const more = a.getByRole('button',{name:'Carregar mais conversas',exact:true});
  await more.waitFor({state:'visible'});
  assert.ok((await more.boundingBox()).height >= 44,'Load more minimum touch target');
  await composer(a).fill('Draft during pagination');
  await more.click();
  await more.waitFor({state:'hidden'});
  await ready(a);
  assert.equal(await composer(a).inputValue(),'Draft during pagination');
  await composer(a).fill('');
  pass('progressive inbox preserves selected conversation and draft');
  assert.ok((await notice.get()).data().readAt != null,'Notification mark-read callable');
  const first='Browser message A '+id;
  await composer(a).fill(first);
  await send(a).click();
  await message(a,first).waitFor({state:'visible'});
  await message(b,first).waitFor({state:'visible'});
  const second='Browser reply B '+id;
  await composer(b).fill(second);
  await composer(b).press('Enter');
  await message(a,second).waitFor({state:'visible'});
  await message(b,second).waitFor({state:'visible'});
  pass('bilateral send and receive through real composer');
  await screenshot(a,'a-desktop');
  // Test revocation while both UI contexts remain mounted. The real callable
  // is invoked by B's separate authenticated control SDK, not an Admin write.
  const draft='Private draft '+id;
  await composer(a).fill(draft);
  await httpsCallable(functions,'blockUser')({targetUid:aUid});
  for (const page of [a,b]) {
    await message(page,first).waitFor({state:'hidden'});
    await message(page,second).waitFor({state:'hidden'});
    await until('revoked composer',async()=> (await composer(page).count())===0 ||
      (await composer(page).getAttribute('aria-readonly'))==='true',Boolean);
    assert.equal(await page.locator('.conversation-card').count(),0);
  }
  if(await composer(a).count()) await until('revoked draft cleared',()=>composer(a).inputValue(),v=>v==='');
  await screenshot(a,'a-revoked');
  pass('live bilateral revocation without refresh and draft isolation');
  await httpsCallable(functions,'unblockUser')({targetUid:aUid});
  for (const page of [a,b]) {
    await page.locator('.conversation-card').first().waitFor({state:'visible'});
    // Reopen through the real list if selection was cleared on revocation.
    await page.locator('.conversation-card').first().click();
    await ready(page);
    await message(page,first).waitFor({state:'visible'});
  }
  pass('live recovery and retained authorized history');
  await logout(a);
  await login(a,cUid);
  await a.goto(BASE+'/notificacoes');
  await a.getByRole('heading',{name:'Notificações',exact:true}).waitFor();
  assert.equal(await a.getByText(notificationTitle,{exact:true}).count(),0);
  await a.goto(BASE+'/chat?openChatId='+encodeURIComponent(chatId));
  await a.locator('.chat-shell').waitFor();
  await until('C cannot compose',async()=> (await composer(a).count())===0 ||
    (await composer(a).getAttribute('aria-readonly'))==='true',Boolean);
  assert.equal(await message(a,first).count(),0);
  assert.equal(await message(a,second).count(),0);
  assert.equal(await a.locator('.conversation-card').count(),0);
  await message(b,first).waitFor({state:'visible'});
  pass('A to C session isolation and independent B history');
  await logout(a);
  await login(a,aUid);
  await openChat(a,chatId);
  await message(a,first).waitFor({state:'visible'});
  assert.equal(await composer(a).inputValue(),'');
  pass('A return with canonical history and no stale draft');
  await a.setViewportSize({width:390,height:844});
  await screenshot(a,'a-mobile');
  const metrics=await a.evaluate(()=>{
    const input=document.querySelector('.chat-shell__composer-main textarea');
    const button=document.querySelector('.chat-shell__send');
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      composerName:input?.getAttribute('aria-label'),sendHeight:button?.getBoundingClientRect().height ?? 0};
  });
  assert.ok(metrics.composerName,'Composer accessible name');
  assert.ok(metrics.scrollWidth<=metrics.width+1,'Horizontal overflow');
  assert.ok(metrics.sendHeight>=44,'Send action minimum touch target');
  pass('mobile layout and accessible composer');
  assert.equal(browserErrors.filter(e=>e.type==='pageerror').length,0,'Unhandled browser exceptions');
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'PASS',phases,metrics},null,2));
} catch(error) {
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'FAIL',phases,error:String(error)},null,2));
  for(const {name,page} of pages) await screenshot(page,name+'-failure').catch(()=>{});
  throw error;
} finally {
  writeFileSync(resolve(out,'browser-diagnostics.json'),JSON.stringify(browserErrors,null,2));
  await browser?.close();
  if(server) server.kill('SIGTERM');
  log.end();
  await deleteApp(sdk);
  await deleteAdminApp(admin);
}
