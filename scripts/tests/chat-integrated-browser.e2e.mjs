import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
const [aUid,bUid,cUid,dUid,eUid] = ['a','b','c','d','e'].map(uid);
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
// Diagnostic-only counters: no request body, auth header, UID or URL query recorded.
const callableCounts = new Map();
function recordCallable(name, response) {
  const url = new URL(response.url());
  if(url.hostname!=='127.0.0.1' || url.port!=='15001' || response.request().method()!=='POST') return;
  const endpoint = url.pathname.split('/').at(-1);
  if(!endpoint || !/^[A-Za-z][A-Za-z0-9]*$/.test(endpoint)) return;
  const key = name+':'+endpoint;
  const row = callableCounts.get(key) ?? {context:name,endpoint,total:0,rateLimited:0,failed:0};
  row.total++;
  if(response.status()===429) row.rateLimited++;
  if(response.status()>=400) row.failed++;
  callableCounts.set(key,row);
}

const performanceSamples = {roundTrips: [], recoveryMs: null, switches: [], receiptConvergenceMs: null};
const PHASE_BUDGET_MS = 60_000;
// Immutable measurements extracted from the successful 4.3A runner artifact.
// Compare like-for-like before adding the larger workload; deltas are descriptive.
const baseline = {
  commit:'9d4c779d48ec628b893cb405522c744ce50d6e44', runId:45813552581, artifactId:15114198896,
  sendReceive:{count:8,p50:232,p95:256,max:256},
  conversationSwitch:{count:6,p50:119,p95:218,max:218},
  recoveryMs:2306,receiptConvergenceMs:10,
};
const historySamples = {initialCount:null,pagination:[],liveArrivalMs:null,
  offlineAdded:0,offlineRecoveryMs:null,gapPages:0,recoveryPages:0,
  recoveredCount:null,profileEntryMs:null,revocationMs:null};
function baselineComparison() {
  const sendReceive = sampleSummary(performanceSamples.roundTrips.map(row=>row.ms));
  const conversationSwitch = sampleSummary(performanceSamples.switches.map(row=>row.ms));
  const delta = (current,previous) => current===null ? null : current-previous;
  return {baseline, deltaMs:{
    sendReceiveP50:delta(sendReceive?.p50 ?? null,baseline.sendReceive.p50),
    sendReceiveP95:delta(sendReceive?.p95 ?? null,baseline.sendReceive.p95),
    conversationSwitchP50:delta(conversationSwitch?.p50 ?? null,baseline.conversationSwitch.p50),
    conversationSwitchP95:delta(conversationSwitch?.p95 ?? null,baseline.conversationSwitch.p95),
    recovery:delta(performanceSamples.recoveryMs,baseline.recoveryMs),
    receiptConvergence:delta(performanceSamples.receiptConvergenceMs,baseline.receiptConvergenceMs),
  }};
}
function elapsed(start) { return Math.round(performance.now() - start); }
function withinBudget(label, ms) {
  assert.ok(ms <= PHASE_BUDGET_MS, label + ': ' + ms + 'ms exceeds ' + PHASE_BUDGET_MS + 'ms');
}
function sampleSummary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return {count: sorted.length, p50: sorted[Math.ceil(sorted.length*0.5)-1],
    p95: sorted[Math.ceil(sorted.length*0.95)-1], max: sorted.at(-1)};
}
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
  page.on('response', response => recordCallable(name,response));
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
const threadIds = page => page.locator('app-chat-message[data-chat-message-id]')
  .evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-chat-message-id')));
async function expectThread(page, expected, label) {
  await until(label,()=>threadIds(page),ids=>ids.length===expected.length &&
    ids.every((value,index)=>value===expected[index]));
  assert.deepEqual(await threadIds(page),expected,label);
  assert.equal(new Set(expected).size,expected.length,'Fixture IDs unique');
}
async function canonicalIds(chatId) {
  const snap = await db.collection('chats/'+chatId+'/messages')
    .orderBy('timestamp','asc').orderBy('__name__','asc').get();
  return snap.docs.map(doc=>doc.id);
}
async function seedHistory(chatId, prefix, count, baseMs, sender, recipient) {
  // Admin fixture ONLY: synthetic pre-read rows isolate history pagination from
  // sending quota, receipt throughput and notification production.
  const ref = db.collection('chats/'+chatId+'/messages');
  const batch = db.batch();
  const ids = [];
  for(let i=0;i<count;i++) {
    const key = prefix+'-'+String(i).padStart(3,'0');
    const timestamp = new Date(baseMs+Math.floor(i/4)*1000);
    batch.create(ref.doc(key),{messageId:key,content:'Browser history '+id+' '+key,
      senderId:sender,senderUid:sender,recipientUid:recipient,nickname:'Browser Pessoa E',
      timestamp,createdAt:timestamp,status:'read',messageType:'text',clientRequestId:key});
    ids.push(key);
  }
  await batch.commit();
  return ids;
}
const older = page=>page.getByRole('button',{name:'Carregar mensagens anteriores',exact:true});
const gap = page=>page.getByRole('button',{name:'Recuperar mensagens pendentes',exact:true});
async function loadHistoryPage(page, control, label) {
  await control.waitFor({state:'visible'});
  const before = (await threadIds(page)).length;
  const start = performance.now();
  await control.click();
  await until(label,()=>threadIds(page),ids=>ids.length>before);
  const ms = elapsed(start);
  withinBudget(label,ms);
  return ms;
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
  // Sequential bidirectional UI workload below the production sender quota.
  // The receiving context remains independently authenticated throughout.
  const burst = [];
  for (let i=0;i<8;i++) {
    const sender = i%2===0 ? a : b;
    const receiver = i%2===0 ? b : a;
    const content = 'Browser perf '+id+' '+i;
    const start = performance.now();
    await composer(sender).fill(content);
    if(i%2===0) await send(sender).click(); else await composer(sender).press('Enter');
    await Promise.all([message(sender,content).waitFor({state:'visible'}),
      message(receiver,content).waitFor({state:'visible'})]);
    const ms = elapsed(start);
    performanceSamples.roundTrips.push({index:i, direction:i%2===0?'A-B':'B-A',ms});
    withinBudget('send and receive '+i,ms);
    burst.push(content);
  }
  // Use the actual rendered thread, excluding inbox previews, and verify order
  // and uniqueness, not merely the presence of the last message.
  for (const page of [a,b]) {
    const rendered = (await page.locator('app-chat-message .thread-message__content').allTextContents())
      .map(content=>content.trim()).filter(content=>burst.includes(content));
    assert.deepEqual(rendered,burst,'Ordered unique rendered workload');
  }
  const receiptStart = performance.now();
  await until('all workload receipts confirmed by Firestore',async()=>{
    const snap = await db.collection('chats/'+chatId+'/messages').get();
    const rows = snap.docs.map(doc=>doc.data()).filter(row=>burst.includes(row.content));
    return rows.length===burst.length && new Set(rows.map(row=>row.content)).size===burst.length &&
      rows.every(row=>row.status==='read');
  },Boolean,PHASE_BUDGET_MS);
  performanceSamples.receiptConvergenceMs = elapsed(receiptStart);
  withinBudget('receipt convergence',performanceSamples.receiptConvergenceMs);
  pass('ordered bidirectional workload and canonical read receipts');
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
  // Simulate transport interruption in B only; the sender remains online.
  const offlineMessage = 'Browser offline recovery '+id;
  await b.context().setOffline(true);
  try {
    await composer(a).fill(offlineMessage);
    await send(a).click();
    await message(a,offlineMessage).waitFor({state:'visible'});
    assert.equal(await message(b,offlineMessage).count(),0,'Offline peer received unexpected new DOM content');
  } finally {
    await b.context().setOffline(false);
  }
  const recoveryStart = performance.now();
  // No refresh, navigation or SDK sign-in is performed in B.
  await message(b,offlineMessage).waitFor({state:'visible'});
  performanceSamples.recoveryMs = elapsed(recoveryStart);
  withinBudget('offline recovery',performanceSamples.recoveryMs);
  assert.equal(await message(b,offlineMessage).count(),1);
  pass('independent network recovery without reload or duplicate message');
  // Only after the original unauthorized C scenario, grant a second synthetic
  // friendship to exercise actual in-app switching between distinct histories.
  await Promise.all([
    db.doc('users/'+aUid+'/friends/'+cUid).set({accepted:true}),
    db.doc('users/'+cUid+'/friends/'+aUid).set({accepted:true}),
  ]);
  await signInWithEmailAndPassword(auth,email(aUid),password);
  const secondChat = (await httpsCallable(functions,'ensureDirectChat')({otherUserUid:cUid})).data.chatId;
  assert.ok(secondChat && secondChat!==chatId);
  const secondMarker = 'Browser alternate history '+id;
  await httpsCallable(functions,'sendDirectMessage')({chatId:secondChat,content:secondMarker,
    clientRequestId:randomUUID()});
  const cardB = a.locator('.conversation-card').filter({hasText:'Browser Pessoa B'});
  const cardC = a.locator('.conversation-card').filter({hasText:'Browser Pessoa C'});
  await cardB.waitFor({state:'visible'});
  await cardC.waitFor({state:'visible'});
  for (let i=0;i<6;i++) {
    const alternate = i%2===0;
    const target = alternate ? cardC : cardB;
    const expected = alternate ? secondMarker : offlineMessage;
    const forbidden = alternate ? offlineMessage : secondMarker;
    const start = performance.now();
    await target.click();
    await message(a,expected).waitFor({state:'visible'});
    await message(a,forbidden).waitFor({state:'hidden'});
    await until('selected conversation',()=>target.getAttribute('aria-pressed'),value=>value==='true');
    const ms = elapsed(start);
    performanceSamples.switches.push({index:i,ms});
    withinBudget('conversation switch '+i,ms);
    assert.equal(await message(a,expected).count(),1);
  }
  await message(b,offlineMessage).waitFor({state:'visible'});
  assert.equal(await message(b,secondMarker).count(),0,'Other account exposed alternate history');
  pass('six in-app conversation switches with isolated histories and independent peer');
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

  // Keep all 4.3A measurements above unchanged. The following independent
  // workload intentionally exceeds the 60-document realtime window.
  // Separate principals preserve the real per-user quotas. The preceding
  // burst can exhaust chat discovery and pending-request read budgets.
  // No ledger reset, quota increase, mocked authorization or retry bypass.
  for (const [user,nickname] of [[dUid,'Browser Pessoa D'],[eUid,'Browser Pessoa E']]) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('history registration seed',()=>db.doc('users/'+user).get(),s=>s.exists);
    const profile = {uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),
      gender:'mulher',identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',
      role:'free',municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
  }
  await seedPublicMediaCompliance(db,[dUid,eUid]);
  // A complete connection must be generated by the canonical backend.
  // Minimal accepted:true edges are invisible to watchFriends (orderBy lastInteractionAt).
  await signInWithEmailAndPassword(auth,email(dUid),password);
  const request = (await httpsCallable(functions,'sendFriendRequest')({targetUid:eUid})).data;
  assert.equal(request.status,'pending');
  assert.ok(request.requestId);
  await signInWithEmailAndPassword(auth,email(eUid),password);
  const accepted = (await httpsCallable(functions,'acceptFriendRequest')({requestId:request.requestId})).data;
  assert.equal(accepted.status,'accepted');
  assert.equal(accepted.requesterUid,dUid);
  assert.equal(accepted.targetUid,eUid);
  for (const [owner,peer] of [[dUid,eUid],[eUid,dUid]]) {
    const edge = await db.doc('users/'+owner+'/friends/'+peer).get();
    assert.equal(edge.get('friendUid'),peer);
    assert.ok(edge.get('lastInteractionAt')?.toMillis()>0,'Canonical ordered friendship edge');
    assert.equal(edge.get('source'),'accepted-request');
  }
  pass('canonical bilateral friendship created through authenticated request and acceptance');
  await signInWithEmailAndPassword(auth,email(dUid),password);
  const historyChat = (await httpsCallable(functions,'ensureDirectChat')({otherUserUid:eUid})).data.chatId;
  assert.ok(historyChat && historyChat!==chatId && historyChat!==secondChat);
  const historyMarker = 'Browser canonical history '+id;
  await httpsCallable(functions,'sendDirectMessage')({chatId:historyChat,content:historyMarker,
    clientRequestId:randomUUID()});
  const d = await newPage('d-history');
  await login(d,dUid);
  const initialSecond = await db.collection('chats/'+historyChat+'/messages').get();
  assert.equal(initialSecond.size,1);
  const initialMessage = initialSecond.docs[0];
  assert.equal(initialMessage.get('content'),historyMarker);
  const initialMs = initialMessage.get('timestamp').toMillis();
  const seeded = await seedHistory(historyChat,'history',104,initialMs-120_000,eUid,dUid);
  const initialExpected = [...seeded,initialMessage.id];
  assert.deepEqual(await canonicalIds(historyChat),initialExpected);
  // Real connected-profile CTA (no direct navigation to Chat or mocked callable).
  await d.goto(BASE+'/perfil/'+encodeURIComponent(eUid));
  const profileChat = d.getByRole('button',{name:'Conversar com Browser Pessoa E',exact:true});
  await profileChat.waitFor({state:'visible'});
  const profileStart = performance.now();
  await profileChat.click();
  await ready(d);
  await expectThread(d,initialExpected.slice(-60),'initial bounded window');
  historySamples.profileEntryMs = elapsed(profileStart);
  historySamples.initialCount = (await threadIds(d)).length;
  withinBudget('profile entry',historySamples.profileEntryMs);
  assert.equal(await message(d,offlineMessage).count(),0);
  pass('connected profile opens authorized chat and bounded 60-message window');

  await composer(d).fill('Draft during history pagination');
  for(const size of [80,100,105]) {
    const ms = await loadHistoryPage(d,older(d),'older history '+size);
    await expectThread(d,initialExpected.slice(-size),'ordered history '+size);
    assert.equal(await composer(d).inputValue(),'Draft during history pagination');
    historySamples.pagination.push({count:size,ms});
  }
  await older(d).waitFor({state:'hidden'});
  pass('105 messages through three cursor pages including equal timestamps and no duplicates');

  // New canonical message through real UI while the complete historical
  // pages remain mounted. This must not evict or reorder the loaded history.
  const liveMarker = 'Browser paginated live '+id;
  const liveStart = performance.now();
  await composer(d).fill(liveMarker);
  await composer(d).press('Enter');
  await message(d,liveMarker).waitFor({state:'visible'});
  const beforeOffline = await canonicalIds(historyChat);
  assert.equal(beforeOffline.length,106);
  assert.deepEqual(beforeOffline.slice(0,-1),initialExpected);
  await expectThread(d,beforeOffline,'live update with loaded history');
  historySamples.liveArrivalMs = elapsed(liveStart);
  withinBudget('live update with history',historySamples.liveArrivalMs);
  pass('real-time send retains previously paginated history');

  // Reenter the thread with a clean window; then exceed the window while D
  // alone is offline. Fixture write is atomic and all rows are synthetic.
  await openChat(d,historyChat);
  await expectThread(d,beforeOffline.slice(-60),'pre-interruption bounded window');
  const newestBefore = await db.doc('chats/'+historyChat+'/messages/'+beforeOffline.at(-1)).get();
  const offlineBase = newestBefore.get('timestamp').toMillis()+1000;
  let missed;
  await d.context().setOffline(true);
  try {
    missed = await seedHistory(historyChat,'offline',75,offlineBase,eUid,dUid);
    historySamples.offlineAdded = missed.length;
    assert.equal((await threadIds(d)).some(key=>missed.includes(key)),false,
      'New remote fixture unexpectedly visible while offline');
  } finally {
    await d.context().setOffline(false);
  }
  const recoveryStart2 = performance.now();
  await until('latest offline message restored',()=>threadIds(d),ids=>ids.includes(missed.at(-1)));
  historySamples.offlineRecoveryMs = elapsed(recoveryStart2);
  withinBudget('bulk offline latest recovery',historySamples.offlineRecoveryMs);
  // A confirmed transport reset may intentionally clear the previous window.
  // Recover via the explicit gap action when present; otherwise the ordinary
  // historical cursor must expose the complete contiguous history.
  const completeHistory = [...beforeOffline,...missed];
  assert.deepEqual(await canonicalIds(historyChat),completeHistory);
  while(await gap(d).isVisible()) {
    assert.ok(historySamples.gapPages<10,'Unbounded gap recovery');
    await loadHistoryPage(d,gap(d),'gap recovery');
    historySamples.gapPages++;
  }
  while((await threadIds(d)).length<completeHistory.length) {
    assert.ok(historySamples.recoveryPages<12,'Unbounded history recovery');
    await loadHistoryPage(d,older(d),'post-reconnect older history');
    historySamples.recoveryPages++;
  }
  await expectThread(d,completeHistory,'complete 181-message history after reconnect');
  await gap(d).waitFor({state:'hidden'});
  historySamples.recoveredCount = (await threadIds(d)).length;
  pass('75 remote messages during offline interval and complete 181-message history after reconnect');
  await screenshot(d,'d-history-recovered');

  // Revoke access after history is fully materialized; no historical rows
  // may survive in the mounted UI, while B retains its unrelated conversation.
  const revokeStart = performance.now();
  await httpsCallable(functions,'blockUser')({targetUid:eUid});
  const privateIds = new Set(completeHistory);
  await until('bulk history revoked',()=>threadIds(d),ids=>ids.every(key=>!privateIds.has(key)));
  await d.locator('.conversation-card').filter({hasText:'Browser Pessoa E'}).waitFor({state:'hidden'});
  historySamples.revocationMs = elapsed(revokeStart);
  withinBudget('bulk history revocation',historySamples.revocationMs);
  await message(b,offlineMessage).waitFor({state:'visible'});
  assert.equal((await threadIds(b)).some(key=>privateIds.has(key)),false);
  pass('live revocation purges loaded history without affecting independent chat');
  assert.equal(browserErrors.filter(e=>e.type==='pageerror').length,0,'Unhandled browser exceptions');
  const discovery = [...callableCounts.values()].filter(row=>row.endpoint==='listDirectChatCandidates');
  const discoveryTotal = discovery.reduce((sum,row)=>sum+row.total,0);
  const discovery429 = discovery.reduce((sum,row)=>sum+row.rateLimited,0);
  console.log('Discovery response comparison '+JSON.stringify({
    baseline:60, baseline429:1, actual:discoveryTotal, delta:discoveryTotal-60, rateLimited:discovery429
  }));
  assert.ok(discoveryTotal>0,'Discovery instrumentation captured no requests');
  assert.equal(discovery429,0,'Discovery must not exhaust quota in the certified workload');
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'PASS',phases,metrics,performanceSamples,historySamples,baselineComparison:baselineComparison(),
    performanceSummary:{budgetMs:PHASE_BUDGET_MS,sendReceive:sampleSummary(performanceSamples.roundTrips.map(row=>row.ms)),
      conversationSwitch:sampleSummary(performanceSamples.switches.map(row=>row.ms))}},null,2));
} catch(error) {
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'FAIL',phases,performanceSamples,historySamples,baselineComparison:baselineComparison(),error:String(error)},null,2));
  for(const {name,page} of pages) await screenshot(page,name+'-failure').catch(()=>{});
  throw error;
} finally {
  writeFileSync(resolve(out,'browser-diagnostics.json'),JSON.stringify(browserErrors,null,2));
  writeFileSync(resolve(out,'callable-counts.json'),JSON.stringify([...callableCounts.values()].sort((a,b)=>b.total-a.total),null,2));
  await browser?.close();
  if(server) server.kill('SIGTERM');
  log.end();
  await deleteApp(sdk);
  await deleteAdminApp(admin);
}
