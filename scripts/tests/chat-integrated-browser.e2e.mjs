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
import { summarizePendingAttempts, recoverPendingAttempt, summarizeSharedFriendsWatch } from './chat-integrated-browser-metrics.mjs';

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
const pendingReadTrace = [], friendshipSamples = [], pendingOrigins = [];
const requestStarts = new WeakMap();
// Runner-local handles only; never serialize request contents.
const pendingRequestHandles = new Map();
const recordedTransportFailures = new WeakSet();
const pendingAttempts = [];
const originalContexts = new Set(['a','b','d-history']);
const spaContext = 'spa-lifecycle';
const spaSamples = [];
const resilienceContext = 'resilience';
const resilienceSamples = {};
const adaptiveContext = 'adaptive-polling';
const adaptiveSamples = {};
const concurrencyContexts = new Set(['concurrency-tab-a','concurrency-tab-b','concurrency-peer']);
const concurrencySamples = {stages:[], resources:[], convergences:[]};
const pendingResources = [];
const sharedFriendsTrace = [], sharedFriendsSamples = [];
const pendingAdmission = [];
const admissionCancellationContext = 'admission-cancellation';
const admissionCancellationSamples = {};
// Independent transport barrier for the complementary offline proof.
const offlineContexts = new WeakSet();
const isComplementary = row => !originalContexts.has(row.context) && row.context!==spaContext && row.context!==resilienceContext && row.context!==adaptiveContext && !concurrencyContexts.has(row.context);
const accountingTasks = new Set();
let currentPhase = 'initial';
const callableTransportFailures = new Map();
function recordCallableTransportFailure(name, request) {
  const url = new URL(request.url());
  if(url.hostname!=='127.0.0.1' || url.port!=='15001' || request.method()!=='POST') return;
  const endpoint = url.pathname.split('/').at(-1);
  if(!endpoint || !/^[A-Za-z][A-Za-z0-9]*$/.test(endpoint)) return;
  const error = request.failure()?.errorText;
  if(!error || recordedTransportFailures.has(request)) return;
  recordedTransportFailures.add(request);
  const category = /^net::ERR_[A-Z_]+$/.test(error) ? error : 'other';
  if(endpoint==='getPendingFriendRequests') {
    const attempt=requestStarts.get(request);
    if(attempt) { attempt.transportFailure=category; attempt.failureMs=elapsed(attempt.startMs); }
  }
  const key = name+':'+endpoint+':'+category;
  const row = callableTransportFailures.get(key) ?? {context:name,endpoint,category,total:0};
  row.total++;
  callableTransportFailures.set(key,row);
}
const historyFixtureChecks = {publicProfileAuthorized:false, bilateralProjectionConfirmed:false};
function recordCallable(name, response) {
  const url = new URL(response.url());
  if(url.hostname!=='127.0.0.1' || url.port!=='15001' || response.request().method()!=='POST') return;
  const endpoint = url.pathname.split('/').at(-1);
  if(!endpoint || !/^[A-Za-z][A-Za-z0-9]*$/.test(endpoint)) return;
  const key = name+':'+endpoint;
  const timingForDedup=requestStarts.get(response.request());
  if(endpoint==='getPendingFriendRequests' && timingForDedup && timingForDedup.httpStatus!==null) return;
  const row = callableCounts.get(key) ?? {context:name,endpoint,total:0,rateLimited:0,failed:0};
  row.total++;
  if(endpoint==='getPendingFriendRequests') {
    const timing=requestStarts.get(response.request());
    if(timing) { timing.httpStatus=response.status(); timing.responseMs=elapsed(timing.startMs); }
    pendingReadTrace.push({context:name,phase:timing?.phase??'unknown',direction:timing?.direction??'unknown',status:response.status(),startMs:timing?.startMs??null,latencyMs:timing?elapsed(timing.startMs):null});
  }
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
    p95: sorted[Math.ceil(sorted.length*0.95)-1], p99: sorted[Math.ceil(sorted.length*0.99)-1], max: sorted.at(-1)};
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
  currentPhase='after: '+phase;
}
async function newPage(name, viewport={width:1440,height:1000}, existingContext=null) {
  const context = existingContext ?? await browser.newContext({viewport,serviceWorkers:'block'});
  if(!existingContext) {
  // Browser traffic cannot reach a cloud Firebase service or external provider.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
    // Intercepted requests must not bypass an offline emulation boundary.
    if (offlineContexts.has(context)) return route.abort('internetdisconnected');
    return route.continue();
  });
  // A second observation surface, once per context (including shared tabs).
  context.on('response', response => {
    const row=requestStarts.get(response.request());
    if(row) recordCallable(row.context,response);
  });
  context.on('requestfailed', request => {
    const row=requestStarts.get(request);
    if(row) recordCallableTransportFailure(row.context,request);
  });
  await context.addInitScript(() => localStorage.setItem('DEBUG_FRIENDS', '1'));
  }
  const page = await context.newPage();
  const routeCategory = () => {
    const route = new URL(page.url()).pathname.split('/')[1];
    return ['login','perfil','friends','chat','notificacoes','dashboard'].includes(route) ? route : 'other';
  };
  let documentNumber=0;
  page.on('framenavigated', frame => {
    if(frame===page.mainFrame()) pendingOrigins.push({context:name,event:'navigation',route:routeCategory(),phase:currentPhase,atMs:performance.now()});
  });
  page.on('domcontentloaded',()=>{documentNumber++;});
  page.setDefaultTimeout(60_000);
  page.on('request',request=>{
    const url=new URL(request.url());
    if(request.isNavigationRequest() && request.resourceType()==='document' && request.frame()===page.mainFrame()) {
      // This is a document request, not merely an Angular URL change.
      const first=url.pathname.split('/')[1];
      const route=['login','perfil','friends','chat','notificacoes','dashboard'].includes(first)?first:'other';
      pendingOrigins.push({context:name,event:'document-request',route,phase:currentPhase,atMs:performance.now()});
    }
    if(url.hostname!=='127.0.0.1'||url.port!=='15001'||request.method()!=='POST'||url.pathname.split('/').at(-1)!=='getPendingFriendRequests') return;
    let direction='unknown';
    try { const value=request.postDataJSON()?.data?.direction;
      if(value==='inbound'||value==='outbound') direction=value;
    } catch { /* diagnostics only; never store request body */ }
    const attempt={context:name,phase:currentPhase,direction,route:routeCategory(),document:documentNumber,startMs:performance.now(),httpStatus:null,responseMs:null,transportFailure:null,failureMs:null};
    pendingAttempts.push(attempt);
    requestStarts.set(request,attempt);
    pendingRequestHandles.set(request,attempt);
  });
  page.on('response', response => recordCallable(name,response));
  page.on('requestfinished', request => {
    const row=requestStarts.get(request);
    if(!row) return;
    row.finishedMs=elapsed(row.startMs);
    const task=request.response().then(response=>{
      if(response && row.httpStatus===null) {
        row.responseRecoveredAtFinish=true;
        recordCallable(name,response);
      }
    }).catch(()=>{});
    accountingTasks.add(task);
    void task.finally(()=>accountingTasks.delete(task));
  });
  page.on('requestfailed', request => recordCallableTransportFailure(name,request));
  page.on('close',()=>{
    for(const row of pendingAttempts) if(row.context===name && row.httpStatus===null && !row.transportFailure) row.contextClosedWithoutTerminalEvent=true;
  });
  page.on('pageerror', error => browserErrors.push({name,type:'pageerror',message:error.message}));
  page.on('console', message => {
    const match=/^\[Friends\] pending-read (start|subscribe|join|signal|unsubscribe) (inbound|outbound) (session|profile|post-mutation|explicit|other|session-retry|subscriber-join|canonical-event|listener-recovery|poll|quota-wait)\s*$/.exec(message.text());
    if(match) pendingOrigins.push({context:name,event:match[1],direction:match[2],reason:match[3],route:routeCategory(),document:documentNumber,phase:currentPhase,atMs:performance.now()});
    const admission=/^\[Friends\] pending-admission (\d+) (inbound|outbound) (queued|waiting|admitted|expired|failed|cancelled|transport-started)\s*$/.exec(message.text());
    if(admission) pendingAdmission.push({context:name,document:documentNumber,operation:Number(admission[1]),direction:admission[2],event:admission[3],phase:currentPhase,atMs:performance.now()});
    const resource=/^\[Friends\] pending-resource (listener|inbound|outbound) (open|close)\s*$/.exec(message.text());
    if(resource) pendingResources.push({context:name,document:documentNumber,resource:resource[1],event:resource[2],phase:currentPhase,atMs:performance.now()});
    const shared=/^\[Friends\] shared-watch (\d+) (\d+) (listener|consumer|hydration) (open|close) (\d+)\s*$/.exec(message.text());
    if(shared) sharedFriendsTrace.push({context:name,document:documentNumber,entry:Number(shared[1]),
      size:Number(shared[2]),resource:shared[3],event:shared[4],snapshot:Number(shared[5]),
      phase:currentPhase,atMs:performance.now()});
    if (message.type()==='error' || message.type()==='warning') {
      browserErrors.push({name,type:message.type(),message:message.text().slice(0,600)});
    }
  });
  pages.push({name,page});
  return page;
}
async function reconcilePendingTransportEvidence(accepts=()=>true, timeoutMs=1500) {
  await Promise.allSettled([...accountingTasks]);
  const unresolved=[...pendingRequestHandles].filter(([,row])=>accepts(row)&&row.httpStatus===null&&!row.transportFailure);
  await Promise.all(unresolved.map(([request,row])=>recoverPendingAttempt(request,row,{
    onResponse: response=>{
      if(row.httpStatus===null) {
        row.responseRecoveredFromHandle=true;
        recordCallable(row.context,response);
      }
    },
    onFailure: ()=>recordCallableTransportFailure(row.context,request),
    timeoutMs,
  })));
}
async function setVerifiedOffline(page, offline) {
  const context=page.context();
  if(offline) offlineContexts.add(context);
  else offlineContexts.delete(context);
  await context.setOffline(offline);
  await page.waitForFunction(value=>navigator.onLine===!value,offline,{timeout:10_000});
}
async function login(page,user) {
  await page.goto(BASE+'/login');
  await loginFromCurrentPage(page,user);
}
async function loginFromCurrentPage(page,user) {
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
// D.2: separate principals preserve the original workload and real quotas.
// Passive observers exclude optimistic local actions from the DOM proof.
async function certifyFriendshipPair(label,keys,actions) {
  const [sender,receiver]=keys.map(uid);
  for(const user of [sender,receiver]) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('reactive registration seed',()=>db.doc('users/'+user).get(),s=>s.exists);
  }
  await seedPublicMediaCompliance(db,[sender,receiver]);
  for(const [user,nickname] of [[sender,'Browser Reactive Sender '+label],[receiver,'Browser Reactive Receiver '+label]]) {
    const profile={uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),gender:'mulher',
      identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',role:'free',
      municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
    await db.doc('preferences/'+user).set({notificationPreferences:{connections:false}},{merge:true});
  }
  const senderName=label+'-sender',receiverName=label+'-receiver';
  const s=await newPage(senderName),t=await newPage(receiverName);
  const requestId=sender+'_'+receiver;
  const outbound=s.locator('.request-card--outbound[aria-labelledby="request-outbound-'+requestId+'"]');
  const inbound=t.locator('.request-card--inbound[aria-labelledby="request-inbound-'+requestId+'"]');
  const reads=(context,direction)=>pendingReadTrace.filter(row=>row.context===context&&row.direction===direction&&row.status===200&&row.startMs!==null);
  const notifyRef=db.doc('notifications/friend_request_received_'+requestId);
  try {
    currentPhase=label+': mount';
    await Promise.all([login(s,sender),login(t,receiver)]);
    await Promise.all([s.goto(BASE+'/friends/requests'),t.goto(BASE+'/friends/requests')]);
    await s.getByRole('tab',{name:/Enviadas/}).click();
    await t.getByRole('tab',{name:/Recebidas/}).waitFor({state:'visible'});
    for(const page of [s,t]) await page.evaluate(()=>{window.__chatFriendshipCertificationDocument=true;});
    // The login document may already have completed reads. Wait for BOTH
    // directions in the mounted requests document before interrupting transport.
    await until(label+' initial canonical reads in mounted documents',()=>[senderName,receiverName].every(context=>
      ['inbound','outbound'].every(direction=>pendingAttempts.some(row=>row.context===context&&
        row.route==='friends'&&row.document===2&&row.direction===direction&&row.httpStatus===200))),Boolean);
    await s.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
    await t.getByText('Nenhuma solicitação recebida',{exact:true}).waitFor({state:'visible'});
    for(const action of actions) {
      const sending=action==='send'||action==='offline-send',offline=action==='offline-send';
      await signInWithEmailAndPassword(auth,email(sending||action==='cancel'?sender:receiver),password);
      const prevS=reads(senderName,'outbound').at(-1),prevT=reads(receiverName,'inbound').at(-1);
      currentPhase=label+': '+action;
      if(offline) await setVerifiedOffline(t,true);
      const start=performance.now();
      try {
        const endpoint=sending?'sendFriendRequest':action==='cancel'?'cancelFriendRequest':action==='decline'?'declineFriendRequest':'acceptFriendRequest';
        const result=(await httpsCallable(functions,endpoint)(sending?{targetUid:receiver}:{requestId})).data;
        assert.equal(result.requestId,requestId);
        assert.equal(result.status,sending?'pending':action==='cancel'?'canceled':action==='decline'?'declined':'accepted');
        if(sending) assert.equal((await notifyRef.get()).exists,false,'Connection notifications disabled');
        const state=sending?'visible':'hidden';
        // Online assertion precedes the existing 60s periodic deadline.
        await outbound.waitFor({state,timeout:20_000});
        const senderMs=elapsed(start);
        assert.ok(performance.now()-prevS.startMs<60_000,'Sender converged before prior polling deadline');
        let reconnectStart=null;
        if(offline) {
          assert.equal(await t.evaluate(()=>navigator.onLine),false,'Receiver must remain offline before observation');
          assert.equal(await inbound.count(),0,'Offline observer received new request');
          reconnectStart=performance.now();
          await setVerifiedOffline(t,false);
        }
        await inbound.waitFor({state,timeout:offline?60_000:20_000});
        const receiverMs=elapsed(reconnectStart??start);
        if(!offline) assert.ok(performance.now()-prevT.startMs<60_000,'Receiver converged before prior polling deadline');
        assert.ok(reads(senderName,'outbound').some(row=>row.startMs>=start),'Sender performed fresh canonical read');
        assert.ok(reads(receiverName,'inbound').some(row=>row.startMs>=start),'Receiver performed fresh canonical read');
        for(const page of [s,t]) {
          assert.equal(await page.evaluate(()=>window.__chatFriendshipCertificationDocument),true,'No document reload');
          assert.equal(new URL(page.url()).pathname,'/friends/requests');
        }
        friendshipSamples.push({scenario:label,action,senderMs,receiverMs,reconnect:offline});
      } finally { if(offline) await setVerifiedOffline(t,false); }
    }
    pass('mounted independent friendship observers '+label);
  } catch(error) {
    await Promise.allSettled([screenshot(s,label+'-sender-failure'),screenshot(t,label+'-receiver-failure')]);
    throw error;
  } finally {
    // Resolve original request evidence while the complementary contexts are alive.
    try { await reconcilePendingTransportEvidence(row=>row.context===senderName||row.context===receiverName); }
    finally { await Promise.all([s.context().close(),t.context().close()]); }
  }
}

async function certifySpaLifecycle() {
  const [viewer,peerA,peerB,pendingPeer]=['j','k','l','m'].map(uid);
  const names=['Browser SPA Viewer','Browser SPA Alpha','Browser SPA Beta','Browser SPA Pending'];
  for(const [index,user] of [viewer,peerA,peerB,pendingPeer].entries()) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('SPA registration seed',()=>db.doc('users/'+user).get(),snap=>snap.exists);
    await seedPublicMediaCompliance(db,[user]);
    const profile={uid:user,nickname:names[index],nicknameNormalized:names[index].toLowerCase(),
      gender:'mulher',identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',role:'free',
      municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
    await db.doc('preferences/'+user).set({notificationPreferences:{connections:false}},{merge:true});
  }
  // Real callable-created edges include ordering fields and bilateral projections.
  for(const peer of [peerA,peerB]) {
    await signInWithEmailAndPassword(auth,email(viewer),password);
    const request=(await httpsCallable(functions,'sendFriendRequest')({targetUid:peer})).data;
    await signInWithEmailAndPassword(auth,email(peer),password);
    const accepted=(await httpsCallable(functions,'acceptFriendRequest')({requestId:request.requestId})).data;
    assert.equal(accepted.status,'accepted');
  }
  const page=await newPage(spaContext);
  const attempts=()=>pendingAttempts.filter(row=>row.context===spaContext);
  const watchRows=()=>sharedFriendsTrace.filter(row=>row.context===spaContext);
  const watchDocument=()=>watchRows().filter(row=>row.size===24&&row.resource==='listener'&&row.event==='open').at(-1)?.document;
  const watchState=doc=>summarizeSharedFriendsWatch(watchRows().filter(row=>row.document===doc),24);
  const watchSample=async(label,expected,doc=watchDocument())=>{
    assert.ok(Number.isInteger(doc),'Missing shared friends listener trace: '+label);
    try {
      await until('shared friends '+label,()=>watchState(doc),state=>
        state.listener.active===(expected===0?0:1)&&state.consumer.active===expected&&
        (expected===0?state.hydration.active===0:true),20_000);
    } catch(error) {
      console.log('Shared friends watch mismatch '+JSON.stringify({
        label,document:doc,expectedConsumers:expected,...watchState(doc)
      }));
      throw error;
    }
    const state=watchState(doc);
    assert.equal(state.listener.peak,1,'Multiple shared friends listeners: '+label);
    assert.equal(state.hydration.peakPerSnapshot<=1,true,'Duplicate simultaneous hydration: '+label);
    assert.equal(state.unmatchedCloses,0,'Unmatched shared friends close: '+label);
    sharedFriendsSamples.push({label,document:doc,...state});
  };
  const origins=()=>pendingOrigins.filter(row=>row.context===spaContext);
  const documents=()=>origins().filter(row=>row.event==='document-request').length;
  const starts=(reason,direction,since=0)=>origins().filter(row=>row.event==='start'&&row.reason===reason&&(!direction||row.direction===direction)&&row.atMs>=since);
  const completed=(direction,since)=>attempts().some(row=>row.direction===direction&&row.httpStatus===200&&row.startMs>=since);
  const sessionReads=since=>until('SPA authenticated directional bootstrap',()=>completed('inbound',since)&&completed('outbound',since),Boolean);
  const side=name=>page.locator('#app-sidebar').getByRole('link',{name,exact:true});
  const activity=route=>page.locator('app-user-activity-hub a[href="'+route+'"]');
  const home=()=>side('Ir para Hoje');
  const requests=()=>activity('/friends/requests');
  const cards=()=>page.getByRole('listitem',{name:'Ver todas as conexões',exact:true});
  const marker='spa-document-'+id; // ephemeral browser-only test sentinel
  const sameDocument=async()=>assert.equal(await page.evaluate(()=>window.__chatSpaLifecycleDocument),marker,'SPA navigation replaced document');
  const mark=()=>page.evaluate(value=>{window.__chatSpaLifecycleDocument=value;},marker);
  async function stage(label,work,{internal=false}={}) {
    currentPhase='spa: '+label;
    const begin=performance.now(),beforeDocs=documents(),before=attempts().length;
    const originOffset=origins().length;
    let passed=false;
    try {
      await work(begin);
      if(internal) { await sameDocument(); assert.equal(documents(),beforeDocs,'Unexpected document navigation: '+label); }
      passed=true;
    } finally {
      spaSamples.push({phase:label,status:passed?'PASS':'FAIL',elapsedMs:elapsed(begin),documentRequests:documents()-beforeDocs,
        attemptsStarted:attempts().length-before,origins:origins().slice(originOffset).filter(row=>row.event!=='navigation'&&row.event!=='document-request').map(({event,direction,reason})=>({event,direction,reason}))});
    }
  }
  async function navigate(link,path,visible) {
    await link.click();
    await page.waitForURL(url=>url.pathname===path);
    if(visible) await visible.waitFor({state:'visible'});
  }
  async function toHome() { await navigate(home(),'/dashboard/principal',page.locator('.principal-page')); }
  async function toFriends() {
    // The dashboard renders an accessible connection-list anchor with role=listitem.
    await navigate(cards(),'/dashboard/friends/list',page.locator('app-friend-list-page'));
  }
  async function openProfile(peer,name) {
    const link=page.getByRole('link',{name:'Ver perfil adulto de '+name,exact:true});
    await navigate(link,'/perfil/'+peer,page.locator('#profile-heading'));
    await until('correct visited profile',()=>page.locator('#profile-heading').textContent(),value=>value?.trim()===name);
  }
  async function toRequests() {
    await navigate(requests(),'/friends/requests',page.getByRole('tab',{name:/Recebidas/}));
  }
  const pendingCard=page.locator('.request-card--outbound[aria-labelledby="request-outbound-'+viewer+'_'+pendingPeer+'"]');
  try {
    await stage('bootstrap',async begin=>{
      await login(page,viewer);
      await sessionReads(begin);
      await page.locator('#app-sidebar').waitFor({state:'visible'});
      await mark();
      if(new URL(page.url()).pathname!=='/dashboard/principal') await toHome();
      await page.locator('.principal-page').waitFor({state:'visible'});
      await until('initial shared friends watch',()=>watchDocument(),Number.isInteger,20_000);
      // The home feed has a legitimate second consumer (PrincipalFeedService).
      // It must share the session's single listener and release it on exit.
      await watchSample('bootstrap-home',2);
    });
    await stage('home',async()=>{
      if(new URL(page.url()).pathname!=='/dashboard/principal') await toHome();
      await watchSample('home',2);
    },{internal:true});
    await stage('chat',async()=>{
      await navigate(side('Abrir mensagens diretas'),'/chat',page.locator('.chat-shell'));
      await watchSample('chat-after-home',1);
    },{internal:true});
    await stage('chat-to-home',async()=>{
      await toHome();
      await watchSample('chat-to-home',2);
    },{internal:true});
    await stage('friend-requests',async()=>{
      await toRequests();
      await watchSample('requests-after-home',1);
    },{internal:true});
    await stage('notifications',()=>navigate(activity('/notificacoes'),'/notificacoes',page.getByRole('heading',{name:'Notificações',exact:true})),{internal:true});
    await stage('communities',()=>navigate(side('Grupo coletivo persistente com membros, regras, mural, moderação e recursos de interação próprios.'),'/dashboard/comunidades',page.locator('app-community-discovery-page')),{internal:true});
    await stage('friends-list',async()=>{
      await toHome();await watchSample('home-before-friends',2);
      await toFriends();await watchSample('friends-list',1);
    },{internal:true});
    await stage('profile-alpha',async begin=>{
      await openProfile(peerA,names[1]);
      await until('profile alpha subscribes outbound',()=>origins().some(row=>row.atMs>=begin&&row.event==='subscribe'&&row.direction==='outbound'&&row.reason==='profile'),Boolean);
      await watchSample('profile-alpha',2);
    },{internal:true});
    await stage('close-alpha',async begin=>{
      await navigate(page.getByRole('link',{name:'Voltar para os perfis',exact:true}),'/dashboard/explorar',page.locator('.profiles-discovery-page'));
      await until('profile alpha subscription disposed',()=>origins().some(row=>row.atMs>=begin&&row.event==='unsubscribe'&&row.direction==='outbound'&&row.reason==='profile'),Boolean);
      await watchSample('close-alpha',1);
    },{internal:true});
    await stage('profile-beta',async begin=>{
      await toHome();await watchSample('home-before-beta',2);
      await toFriends();await watchSample('friends-list-before-beta',1);
      await openProfile(peerB,names[2]);
      await until('profile beta subscribes outbound',()=>origins().some(row=>row.atMs>=begin&&row.event==='subscribe'&&row.direction==='outbound'&&row.reason==='profile'),Boolean);
      await watchSample('profile-beta',2);
    },{internal:true});
    await stage('return-requests',async()=>{
      await navigate(page.getByRole('link',{name:'Voltar para os perfis',exact:true}),'/dashboard/explorar',page.locator('.profiles-discovery-page'));
      await toRequests();
      await page.getByRole('tab',{name:/Enviadas/}).click();
      await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
      await watchSample('return-requests',1);
    },{internal:true});
    // A healthy session retains its original subscriptions during route changes.
    const beforePoll=origins().filter(row=>row.event==='subscribe'&&(row.reason==='session'||row.reason==='session-retry'));
    spaSamples.push({phase:'session-subscription-audit',subscriptions:beforePoll.map(({direction,reason})=>({direction,reason}))});
    assert.equal(beforePoll.filter(row=>row.direction==='inbound').length,1,'Repeated inbound session subscription during SPA navigation');
    assert.equal(beforePoll.filter(row=>row.direction==='outbound').length,1,'Repeated outbound session subscription during SPA navigation');
    await stage('poll',async begin=>{
      // Real 60s clock; no fake time or change to production cadence.
      await until('both directional contingency polls',()=>starts('poll','inbound',begin).length>0&&starts('poll','outbound',begin).length>0,Boolean,205_000);
    },{internal:true});
    await stage('canonical-event',async begin=>{
      await signInWithEmailAndPassword(auth,email(viewer),password);
      const result=(await httpsCallable(functions,'sendFriendRequest')({targetUid:pendingPeer})).data;
      assert.equal(result.status,'pending');
      await pendingCard.waitFor({state:'visible',timeout:20_000});
      assert.ok(starts('canonical-event','outbound',begin).length>0,'Missing canonical outbound read');
      assert.equal(starts('canonical-event','inbound',begin).length,0,'Unrelated inbound canonical refresh');
    },{internal:true});
    await stage('deep-link',async begin=>{
      // Intentional full document, separate from SPA transitions.
      const prior=documents();
      await page.goto(BASE+'/friends/requests');
      await sessionReads(begin);
      await page.getByRole('tab',{name:/Enviadas/}).click();
      await pendingCard.waitFor({state:'visible'});
      assert.ok(documents()>prior,'Deep link must create a document');
      assert.notEqual(await page.evaluate(()=>window.__chatSpaLifecycleDocument),marker);
    });
    await stage('reload',async begin=>{
      const prior=documents();
      await page.reload();
      await sessionReads(begin);
      await page.getByRole('tab',{name:/Enviadas/}).click();
      await pendingCard.waitFor({state:'visible'});
      assert.ok(documents()>prior,'Reload must create a document');
    });
    await stage('logout',async()=>{
      const doc=watchDocument();
      await watchSample('before-logout',1,doc);
      await logout(page);
      await watchSample('logout',0,doc);
      await pendingCard.waitFor({state:'hidden'});
      const prior=attempts().length;
      await sleep(1_000);
      assert.equal(attempts().length,prior,'Pending callable started after logout');
    });
    await stage('identity-switch',async begin=>{
      // Login through the existing form, not a new document or SDK injection.
      await loginFromCurrentPage(page,peerA);
      await sessionReads(begin);
      if(new URL(page.url()).pathname!=='/dashboard/principal') await toHome();
      await toRequests();
      await page.getByRole('tab',{name:/Enviadas/}).click();
      await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
      assert.equal(await pendingCard.count(),0,'Prior identity request leaked into new session');
    });
    pass('controlled SPA lifecycle, profile consumers, real polling, deep links and identity switch');
  } finally { await page.context().close(); }
}

async function certifyResilience() {
  const [oldUser,newUser,target]=['n','o','p'].map(uid);
  for(const [index,user] of [oldUser,newUser,target].entries()) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('resilience registration seed',()=>db.doc('users/'+user).get(),snap=>snap.exists);
    await seedPublicMediaCompliance(db,[user]);
    const nickname='Browser Resilience '+index;
    const profile={uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),gender:'mulher',
      identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',role:'free',
      municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
    await db.doc('preferences/'+user).set({notificationPreferences:{connections:false}},{merge:true});
  }
  const page=await newPage(resilienceContext);
  const rows=()=>pendingAttempts.filter(row=>row.context===resilienceContext);
  const origins=()=>pendingOrigins.filter(row=>row.context===resilienceContext);
  const card=owner=>page.locator('.request-card--outbound[aria-labelledby="request-outbound-'+owner+'_'+target+'"]');
  const requests=async()=>{
    await page.locator('app-user-activity-hub a[href="/friends/requests"]').click();
    await page.waitForURL(url=>url.pathname==='/friends/requests');
    await page.getByRole('tab',{name:/Enviadas/}).click();
  };
  const bootstrap=since=>until('resilience directional bootstrap',()=>['inbound','outbound'].every(direction=>
    rows().some(row=>row.direction===direction&&row.startMs>=since&&row.httpStatus===200)),Boolean);
  let mode='pass', held=null, holdError=null, releaseHold, delivered=null, failed=null;
  const gate=new Promise(resolve=>{releaseHold=resolve;});
  // Real emulator response, held in transport only; no synthetic authorization.
  await page.route('**/getPendingFriendRequests',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.hostname!=='127.0.0.1'||url.port!=='15001'||req.method()!=='POST'||
        req.postDataJSON()?.data?.direction!=='outbound') return route.fallback();
    if(mode==='hold') {
      mode='pass';
      try {
        const response=await route.fetch({timeout:20_000});
        assert.equal(response.status(),200);
        const body=await response.json();
        assert.ok((body.result??body.data)?.items?.some(item=>item.id===oldUser+'_'+target),'Real old pending request');
        held={at:performance.now(),attempt:requestStarts.get(req)};
        await gate;
        try { await route.fulfill({response}); delivered='fulfilled'; }
        catch { delivered='transport-canceled'; }
      } catch(error) {
        holdError=error;
        await route.abort().catch(()=>{});
      }
      return;
    }
    if(mode==='fail') {
      mode='pass';
      failed={at:performance.now(),attempt:requestStarts.get(req)};
      await route.abort('connectionreset');
      return;
    }
    return route.fallback();
  });
  try {
    currentPhase='resilience: old bootstrap';
    let begin=performance.now();
    await login(page,oldUser);
    await bootstrap(begin);
    await requests();
    await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
    currentPhase='resilience: hold old response';
    await signInWithEmailAndPassword(auth,email(oldUser),password);
    mode='hold';
    assert.equal((await httpsCallable(functions,'sendFriendRequest')({targetUid:target})).data.status,'pending');
    await until('real backend old response held',()=>{if(holdError) throw holdError; return held;},Boolean,30_000);
    assert.ok(held.attempt);
    assert.equal(await card(oldUser).count(),0);
    currentPhase='resilience: logout old';
    begin=performance.now();
    await logout(page);
    await until('old session disposed',()=>['inbound','outbound'].every(direction=>origins().some(row=>row.atMs>=begin&&row.event==='unsubscribe'&&row.reason==='session'&&row.direction===direction)),Boolean);
    currentPhase='resilience: new identity';
    begin=performance.now();
    await loginFromCurrentPage(page,newUser);
    await bootstrap(begin);
    await requests();
    await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
    currentPhase='resilience: release old response';
    const releaseAt=performance.now();
    releaseHold();
    await until('late transport release',()=>delivered,Boolean,20_000);
    await until('late transport terminal event',()=>held.attempt.httpStatus!==null||!!held.attempt.transportFailure,Boolean,20_000);
    await sleep(500);
    assert.equal(await card(oldUser).count(),0);
    await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
    resilienceSamples.late={backendStatus:200,heldMs:Math.round(releaseAt-held.at),release:delivered,
      browserStatus:held.attempt.httpStatus,transportFailure:held.attempt.transportFailure,oldCardVisible:false};
    currentPhase='resilience: transient outbound failure';
    await signInWithEmailAndPassword(auth,email(newUser),password);
    mode='fail';
    assert.equal((await httpsCallable(functions,'sendFriendRequest')({targetUid:target})).data.status,'pending');
    await until('controlled outbound transport failure',()=>failed?.attempt?.transportFailure,Boolean,20_000);
    assert.equal(await card(newUser).count(),0);
    currentPhase='resilience: recovery';
    await card(newUser).waitFor({state:'visible',timeout:85_000});
    assert.ok(rows().some(row=>row.direction==='outbound'&&row.startMs>failed.at&&row.httpStatus===200));
    assert.equal(await card(oldUser).count(),0);
    resilienceSamples.transient={transportFailure:failed.attempt.transportFailure,recoveredMs:elapsed(failed.at)};
    currentPhase='resilience: final logout';
    // The retry is a new subscription of the same operational session.
    // Match its actual direction and reason, not the original bootstrap label.
    const activeConsumers=()=>{
      const balances={};
      for(const row of origins()) {
        if(row.event!=='subscribe'&&row.event!=='unsubscribe') continue;
        const key=row.direction+':'+row.reason;
        balances[key]=(balances[key]??0)+(row.event==='subscribe'?1:-1);
        assert.ok(balances[key]>=0,'Unmatched consumer teardown: '+key);
      }
      return Object.fromEntries(Object.entries(balances).filter(([,count])=>count!==0));
    };
    const activeBefore=activeConsumers();
    assert.deepEqual(activeBefore,{'inbound:session':1,'outbound:session-retry':1},
      'Only the two expected new-session consumers may remain after recovery');
    begin=performance.now();
    await logout(page);
    await until('new session disposed',()=>{
      const closed=origins().filter(row=>row.atMs>=begin&&row.event==='unsubscribe');
      return Object.keys(activeConsumers()).length===0 &&
        Object.keys(activeBefore).every(key=>closed.filter(row=>row.direction+':'+row.reason===key).length===activeBefore[key]);
    },Boolean);
    resilienceSamples.teardown={activeBefore,activeAfter:activeConsumers(),events:origins()
      .filter(row=>row.atMs>=begin&&row.event==='unsubscribe').map(({direction,reason})=>({direction,reason}))};
    const before=rows().length, start=performance.now();
    await sleep(185_000);
    assert.equal(rows().length,before,'No callable after logout beyond maximum adaptive interval');
    assert.equal(origins().filter(row=>row.atMs>=start&&row.event==='start').length,0);
    assert.deepEqual(activeConsumers(),{},'No remaining consumers after anonymous observation');
    assert.equal(origins().filter(row=>row.atMs>=start&&row.event==='subscribe').length,0,'No orphan resubscriptions');
    resilienceSamples.anonymous={observedMs:elapsed(start),attemptsStarted:0,activeConsumers:activeConsumers()};
    pass('resilience real delayed backend response, transient failure recovery and final logout');
  } finally {
    releaseHold();
    await page.context().close();
  }
}

async function certifyAdaptivePolling() {
  const [viewer,target]=['q','r'].map(uid);
  for(const [index,user] of [viewer,target].entries()) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('adaptive registration seed',()=>db.doc('users/'+user).get(),snap=>snap.exists);
    await seedPublicMediaCompliance(db,[user]);
    const nickname='Browser Adaptive '+index;
    const profile={uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),gender:'mulher',
      identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',role:'free',
      municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
    await db.doc('preferences/'+user).set({notificationPreferences:{connections:false}},{merge:true});
  }
  const page=await newPage(adaptiveContext);
  const rows=()=>pendingAttempts.filter(row=>row.context===adaptiveContext);
  const origins=()=>pendingOrigins.filter(row=>row.context===adaptiveContext);
  const reads=since=>['inbound','outbound'].every(direction=>rows().some(row=>row.direction===direction&&row.startMs>=since&&row.httpStatus===200));
  const visible=state=>page.evaluate(value=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>value});
    document.dispatchEvent(new Event('visibilitychange'));
  },state);
  const observe=async(label,duration,expected)=>{
    currentPhase='adaptive: '+label;
    const begin=performance.now(),before=rows().length;
    await sleep(duration);
    const actual=rows().length-before;
    adaptiveSamples[label]={observedMs:elapsed(begin),attempts:actual,expected};
    assert.equal(actual,expected,label+' callable count');
  };
  try {
    currentPhase='adaptive: bootstrap';
    await page.addInitScript(()=>Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}));
    const start=performance.now();
    await login(page,viewer);
    await until('adaptive directional bootstrap',()=>reads(start),Boolean,30_000);
    await page.locator('app-user-activity-hub a[href="/friends/requests"]').click();
    await page.waitForURL(url=>url.pathname==='/friends/requests');
    await page.getByRole('tab',{name:/Enviadas/}).click();
    await page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'});
    await observe('visible',65_000,0);
    await visible('hidden');
    await observe('hidden',65_000,0);
    currentPhase='adaptive: foreground';
    let begin=performance.now();
    await visible('visible');
    await until('adaptive foreground reconciliation',()=>reads(begin),Boolean,20_000);
    adaptiveSamples.foreground={convergenceMs:elapsed(begin)};
    await page.context().setOffline(true);
    await observe('offline',65_000,0);
    currentPhase='adaptive: reconnect';
    begin=performance.now();
    await page.context().setOffline(false);
    await until('adaptive reconnect reconciliation',()=>reads(begin),Boolean,30_000);
    adaptiveSamples.reconnect={convergenceMs:elapsed(begin)};
    await signInWithEmailAndPassword(auth,email(viewer),password);
    currentPhase='adaptive: canonical outbound';
    begin=performance.now();
    assert.equal((await httpsCallable(functions,'sendFriendRequest')({targetUid:target})).data.status,'pending');
    const card=page.locator('.request-card--outbound[aria-labelledby="request-outbound-'+viewer+'_'+target+'"]');
    await card.waitFor({state:'visible',timeout:20_000});
    const canonical=origins().filter(row=>row.atMs>=begin&&row.event==='start'&&row.reason==='canonical-event');
    assert.equal(canonical.filter(row=>row.direction==='outbound').length,1);
    assert.equal(canonical.filter(row=>row.direction==='inbound').length,0);
    adaptiveSamples.canonical={convergenceMs:elapsed(begin),outbound:1,inbound:0};
    currentPhase='adaptive: logout';
    await logout(page);
    await observe('anonymous',185_000,0);
    pass('adaptive polling healthy foreground, controlled hidden input, offline, recovery and directional invalidation');
  } finally {
    await page.context().setOffline(false).catch(()=>{});
    await page.context().close();
  }
}


async function certifyConcurrency() {
  const [viewer,target,independent]=['s','t','u'].map(uid);
  for(const [index,user] of [viewer,target,independent].entries()) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('concurrency registration seed',()=>db.doc('users/'+user).get(),snap=>snap.exists);
    await seedPublicMediaCompliance(db,[user]);
    const nickname='Browser Concurrent '+index;
    const profile={uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),gender:'mulher',
      identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',role:'free',
      municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
    await db.doc('preferences/'+user).set({notificationPreferences:{connections:false}},{merge:true});
  }

  const a=await newPage('concurrency-tab-a');
  const b=await newPage('concurrency-tab-b',undefined,a.context());
  const c=await newPage('concurrency-peer');
  const tabs=[a,b,c];
  const names=['concurrency-tab-a','concurrency-tab-b','concurrency-peer'];
  const rows=()=>pendingAttempts.filter(row=>concurrencyContexts.has(row.context));
  const origins=()=>pendingOrigins.filter(row=>concurrencyContexts.has(row.context));
  const resources=()=>pendingResources.filter(row=>concurrencyContexts.has(row.context));
  const side=(page,name)=>page.locator('#app-sidebar').getByRole('link',{name,exact:true});
  const activity=(page,path)=>page.locator('app-user-activity-hub a[href="'+path+'"]');
  const requestList=async page=>{
    if(new URL(page.url()).pathname!=='/friends/requests') {
      // Chat has no activity hub. The actual sidebar requests link works
      // across authenticated modules, including the profile destination.
      await page.locator('#app-sidebar a[href="/friends/requests"]').click();
      await page.waitForURL(url=>url.pathname==='/friends/requests');
    }
    await page.getByRole('tab',{name:/Enviadas/}).click();
  };
  const card=page=>page.locator('.request-card--outbound[aria-labelledby="request-outbound-'+viewer+'_'+target+'"]');
  const takeStage=async(label,work)=>{
    currentPhase='concurrency: '+label;
    const begin=performance.now(),before=rows().length;
    await work(begin);
    concurrencySamples.stages.push({phase:label,elapsedMs:elapsed(begin),attempts:rows().length-before});
  };
  const capture=async(label)=>{
    for(const [i,page] of tabs.entries()) {
      const session=await page.context().newCDPSession(page);
      try {
        await session.send('Performance.enable');
        const {metrics}=await session.send('Performance.getMetrics');
        const selected=Object.fromEntries(metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','JSEventListeners','TaskDuration'].includes(m.name)).map(m=>[m.name,m.value]));
        concurrencySamples.resources.push({phase:label,context:names[i],metrics:selected});
      } finally {await session.detach();}
    }
  };
  const waitBootstrap=begin=>until('all three directional bootstraps',()=>names.every(context=>['inbound','outbound'].every(direction=>
    rows().some(row=>row.context===context&&row.direction===direction&&row.startMs>=begin&&row.httpStatus===200))),Boolean,85_000);
  let releaseHold;
  const gate=new Promise(resolve=>{releaseHold=resolve;});
  let held=null,holdError=null,mode='pass';
  await a.route('**/getPendingFriendRequests',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(mode!=='hold'||url.hostname!=='127.0.0.1'||url.port!=='15001'||req.method()!=='POST'||
        req.postDataJSON()?.data?.direction!=='outbound') return route.fallback();
    mode='pass';
    try {
      const response=await route.fetch({timeout:20_000});
      assert.equal(response.status(),200);
      const body=await response.json();
      assert.ok((body.result??body.data)?.items?.some(item=>item.id===viewer+'_'+target));
      held={attempt:requestStarts.get(req),at:performance.now()};
      await gate;
      await route.fulfill({response});
    } catch(error) {
      holdError=error;
      await route.abort().catch(()=>{});
    }
  });
  try {
    await takeStage('three tabs, two identities',async begin=>{
      await Promise.all([login(a,viewer),login(c,independent)]);
      // A second tab in the same browser context. Respect actual auth persistence:
      // if this environment uses tab-local auth, authenticate using the real form.
      await b.goto(BASE+'/friends/requests');
      await until('second tab route or login',()=>new URL(b.url()).pathname,path=>path==='/login'||path==='/friends/requests');
      if(new URL(b.url()).pathname==='/login') await loginFromCurrentPage(b,viewer);
      await waitBootstrap(begin);
      await Promise.all(tabs.map(requestList));
      await Promise.all(tabs.map(page=>page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'})));
      await capture('bootstrap');
    });
    await takeStage('concurrent modules',async begin=>{
      await Promise.all([
        side(a,'Abrir mensagens diretas').click(),
        activity(b,'/notificacoes').click(),
        side(c,'Grupo coletivo persistente com membros, regras, mural, moderação e recursos de interação próprios.').click()
      ]);
      await Promise.all([a.locator('.chat-shell').waitFor(),b.getByRole('heading',{name:'Notificações',exact:true}).waitFor(),c.locator('app-community-discovery-page').waitFor()]);
      // A direct profile link is explicitly counted as a document load, not SPA.
      await b.goto(BASE+'/perfil/'+target);
      await b.locator('#profile-heading').waitFor();
      await Promise.all(tabs.map(requestList));
      await until('profile document directional reads',()=>['inbound','outbound'].every(direction=>
        rows().some(row=>row.context===names[1]&&row.direction===direction&&row.startMs>=begin&&row.httpStatus===200)),Boolean,30_000);
      await Promise.all(tabs.map(page=>page.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible'})));
      await capture('modules');
    });
    // No harness quota reservation: the application must coordinate admission.
    await takeStage('canonical burst with held old epoch',async begin=>{
      await signInWithEmailAndPassword(auth,email(viewer),password);
      mode='hold';
      const sent=(await httpsCallable(functions,'sendFriendRequest')({targetUid:target})).data;
      assert.equal(sent.status,'pending');
      await until('held actual first epoch',()=>{if(holdError)throw holdError;return held;},Boolean,85_000);
      assert.ok(held.attempt);
      await card(b).waitFor({state:'visible',timeout:85_000});
      concurrencySamples.convergences.push({event:'send',context:names[1],ms:elapsed(begin)});
      assert.equal(await card(c).count(),0);
      const cancelAt=performance.now();
      assert.equal((await httpsCallable(functions,'cancelFriendRequest')({requestId:sent.requestId})).data.status,'canceled');
      await Promise.all([
        (async()=>{
          await card(b).waitFor({state:'hidden',timeout:85_000});
          await until('new epoch HTTP on second tab',()=>rows().some(row=>row.context===names[1]&&row.direction==='outbound'&&row.startMs>=cancelAt&&row.httpStatus===200),Boolean,85_000);
          concurrencySamples.convergences.push({event:'cancel',context:names[1],ms:elapsed(cancelAt)});
        })(),
        (async()=>{
          await until('new epoch HTTP on held tab',()=>rows().some(row=>row.context===names[0]&&row.direction==='outbound'&&row.startMs>=cancelAt&&row.httpStatus===200),Boolean,85_000);
          await a.getByText('Nenhuma solicitação enviada',{exact:true}).waitFor({state:'visible',timeout:85_000});
          concurrencySamples.convergences.push({event:'cancel',context:names[0],ms:elapsed(cancelAt)});
        })()
      ]);
      releaseHold();
      await until('held epoch delivered',()=>{if(holdError)throw holdError;return held.attempt.httpStatus===200;},Boolean,20_000);
      await sleep(500);
      for(const page of tabs) assert.equal(await card(page).count(),0,'Stale or cross-identity request visible');
      const starts=origins().filter(row=>row.atMs>=begin&&row.event==='start'&&row.reason==='canonical-event');
      assert.equal(starts.filter(row=>row.context===names[0]&&row.direction==='outbound').length,2);
      assert.equal(starts.filter(row=>row.context===names[1]&&row.direction==='outbound').length,2);
      assert.equal(starts.filter(row=>row.direction==='inbound'||row.context===names[2]).length,0);
      concurrencySamples.held={durationMs:elapsed(held.at),httpStatus:held.attempt.httpStatus,obsoleteVisible:false};
    });
    await takeStage('simultaneous reconnect',async()=>{
      await Promise.all([setVerifiedOffline(a,true),setVerifiedOffline(c,true)]);
      await b.waitForFunction(()=>navigator.onLine===false,undefined,{timeout:10_000});
      await sleep(1_000);
      const begin=performance.now();
      await Promise.all([setVerifiedOffline(a,false),setVerifiedOffline(c,false)]);
      await b.waitForFunction(()=>navigator.onLine===true,undefined,{timeout:10_000});
      await waitBootstrap(begin);
      concurrencySamples.convergences.push({event:'reconnect-all',context:'all',ms:elapsed(begin)});
      await capture('reconnected');
    });
    // Verify the logical listener/clock balance per live document. Disposed
    // documents can disappear without a JS teardown event: do not infer one.
    for(const name of names) {
      const doc=Math.max(...resources().filter(row=>row.context===name).map(row=>row.document));
      assert.ok(Number.isFinite(doc),'Resource tracing unavailable: '+name);
      const balance={listener:0,inbound:0,outbound:0},peak={listener:0,inbound:0,outbound:0};
      for(const row of resources().filter(row=>row.context===name&&row.document===doc)) {
        balance[row.resource]+=row.event==='open'?1:-1;
        assert.ok(balance[row.resource]>=0,'Unmatched resource closure');
        peak[row.resource]=Math.max(peak[row.resource],balance[row.resource]);
      }
      assert.ok(Object.values(peak).every(value=>value<=1),'Multiple logical clocks/listeners per live document');
      concurrencySamples.resources.push({context:name,document:doc,balance,peak});
    }
    await takeStage('logout all contexts',async begin=>{
      await logout(a);
      // Shared local auth may already have signed B out; tab-local auth may not.
      await until('second tab authenticated or logged out',()=>new URL(b.url()).pathname,path=>path==='/login'||path==='/friends/requests',20_000);
      if(new URL(b.url()).pathname!=='/login'&&await b.locator('.account-menu__summary').isVisible()) {
        await logout(b).catch(async error=>{if(new URL(b.url()).pathname!=='/login')throw error;});
      }
      await logout(c);
      await Promise.all(tabs.map(page=>page.locator('#email').waitFor({state:'visible'})));
      await until('consumer teardown each tab',()=>names.every(context=>['inbound','outbound'].every(direction=>
        origins().some(row=>row.context===context&&row.direction===direction&&row.event==='unsubscribe'&&row.atMs>=begin))),Boolean,20_000);
      const before=rows().length;
      await sleep(185_000);
      assert.equal(rows().length,before,'Orphan concurrent polling after logout');
      concurrencySamples.anonymous={observedMs:185_000,attempts:0};
    });
    const quotaWaits=origins().filter(row=>row.event==='signal'&&row.reason==='quota-wait');
    concurrencySamples.admission={waitSignals:quotaWaits.length,contexts:quotaWaits.reduce((acc,row)=>{
      acc[row.context]=(acc[row.context]??0)+1;return acc;
    },{}),harnessBudgetWaits:0};
    assert.ok(quotaWaits.length>0,'Unpaced workload never exercised application admission');
    assert.equal(rows().filter(row=>row.httpStatus===429).length,0,'Concurrent workload exceeded unchanged read quota');
    pass('concurrent tabs and modules, directional burst, stale epoch discard, reconnect and teardown');
  } catch(error) {
    await Promise.allSettled(tabs.map((page,index)=>screenshot(page,names[index]+'-failure')));
    throw error;
  } finally {
    releaseHold();
    await Promise.allSettled([a.context().close(),c.context().close()]);
    const events=rows().flatMap(row=>{
      const terminal=row.responseMs??row.failureMs;
      return [{at:row.startMs,delta:1},...(terminal===null?[]:[{at:row.startMs+terminal,delta:-1}])];
    }).sort((a,b)=>a.at-b.at||b.delta-a.delta);
    let active=0,peak=0;
    for(const event of events){active+=event.delta;peak=Math.max(peak,active);}
    concurrencySamples.transport={peakObservedOpenAttempts:peak,unsettled:rows().filter(row=>row.httpStatus===null&&!row.transportFailure).length,
      httpLatency:sampleSummary(rows().filter(row=>row.responseMs!==null).map(row=>row.responseMs)),
      convergence:sampleSummary(concurrencySamples.convergences.map(row=>row.ms))};
  }
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
  for (const user of [dUid,eUid]) {
    await adminAuth.createUser({uid:user,email:email(user),password,emailVerified:true});
    await until('history registration seed',()=>db.doc('users/'+user).get(),s=>s.exists);
  }
  // The registration seed is hidden/interaction-blocked. Complete compliance
  // before publishing: otherwise the real discovery trigger can delete the fixture.
  await seedPublicMediaCompliance(db,[dUid,eUid]);
  for (const [user,nickname] of [[dUid,'Browser Pessoa D'],[eUid,'Browser Pessoa E']]) {
    const profile = {uid:user,nickname,nicknameNormalized:nickname.toLowerCase(),
      gender:'mulher',identityCode:'mulher',identityCatalogVersion:1,orientation:'bissexual',
      role:'free',municipio:'Rio de Janeiro',estado:'RJ',createdAt:new Date(),updatedAt:new Date()};
    await db.doc('users/'+user).set({...profile,emailVerified:true,loginAllowed:true,accountLocked:false},{merge:true});
    await db.doc('public_profiles/'+user).set(profile);
  }
  // A complete connection must be generated by the canonical backend.
  // Minimal accepted:true edges are invisible to watchFriends (orderBy lastInteractionAt).
  await signInWithEmailAndPassword(auth,email(dUid),password);
  // Exercise all four canonical mutation events, independently of notification
  // preferences. The private revision contains only a direction-specific counter.
  const readRevision = async () => {
    const [requester,target] = await Promise.all([db.doc('users/'+dUid).get(),db.doc('users/'+eUid).get()]);
    return [requester.get('pendingFriendRequestsOutboundRevision') ?? 0,
      target.get('pendingFriendRequestsInboundRevision') ?? 0,
      requester.get('pendingFriendRequestsInboundRevision') ?? 0,
      target.get('pendingFriendRequestsOutboundRevision') ?? 0];
  };
  const initialRevision = await readRevision();
  const expectRevision = async (delta) => assert.deepEqual(await readRevision(),
    initialRevision.map((value,index)=>index<2 ? value+delta : value),'Canonical directional revision');
  const canceled = (await httpsCallable(functions,'sendFriendRequest')({targetUid:eUid})).data;
  await expectRevision(1);
  assert.equal((await httpsCallable(functions,'cancelFriendRequest')({requestId:canceled.requestId})).data.status,'canceled');
  await expectRevision(2);
  const declined = (await httpsCallable(functions,'sendFriendRequest')({targetUid:eUid})).data;
  await expectRevision(3);
  await signInWithEmailAndPassword(auth,email(eUid),password);
  assert.equal((await httpsCallable(functions,'declineFriendRequest')({requestId:declined.requestId})).data.status,'declined');
  await expectRevision(4);
  await signInWithEmailAndPassword(auth,email(dUid),password);
  const request = (await httpsCallable(functions,'sendFriendRequest')({targetUid:eUid})).data;
  await expectRevision(5);
  assert.equal(request.status,'pending');
  assert.ok(request.requestId);
  await signInWithEmailAndPassword(auth,email(eUid),password);
  const accepted = (await httpsCallable(functions,'acceptFriendRequest')({requestId:request.requestId})).data;
  assert.equal(accepted.status,'accepted');
  await expectRevision(6);
  console.log('PASS canonical directional invalidation counters for send, cancel, decline and accept');
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
  const initialSecond = await db.collection('chats/'+historyChat+'/messages').get();
  assert.equal(initialSecond.size,1);
  const initialMessage = initialSecond.docs[0];
  assert.equal(initialMessage.get('content'),historyMarker);
  const initialMs = initialMessage.get('timestamp').toMillis();
  const seeded = await seedHistory(historyChat,'history',104,initialMs-120_000,eUid,dUid);
  const initialExpected = [...seeded,initialMessage.id];
  assert.deepEqual(await canonicalIds(historyChat),initialExpected);
  // Complete the synthetic fixture BEFORE starting browser D. The same
  // authenticated backend boundary used by the application must see E,
  // and the real reconciliation transaction must materialize the viewer's
  // bilateral projection. No admin grant, mocked response or quota reset.
  // Legacy missing-projection recovery is covered by the independent Media
  // and Rules suites; this scenario starts from an established connection.
  const authorizedProfile = (await httpsCallable(functions,'getPublicProfilesPage')({uids:[eUid]})).data;
  assert.ok(Array.isArray(authorizedProfile.items) &&
    authorizedProfile.items.some(item=>item.uid===eUid),'History fixture: backend must authorize connected public profile');
  historyFixtureChecks.publicProfileAuthorized = true;
  const reconciled = (await httpsCallable(functions,'reconcilePublicMediaAccess')({ownerUid:eUid})).data;
  assert.equal(reconciled.reconciled,true,'History fixture: canonical bilateral reconciliation');
  const projection = await db.doc('public_media_access/'+dUid+'/owners/'+eUid).get();
  assert.equal(projection.get('version'),1,'History fixture: canonical bilateral version');
  assert.equal(projection.get('ownerUid'),eUid,'History fixture: correct projection owner');
  assert.equal(projection.get('available'),true,'History fixture: backend-confirmed bilateral access');
  historyFixtureChecks.bilateralProjectionConfirmed = true;
  console.log('History fixture prerequisites '+JSON.stringify(historyFixtureChecks));
  const d = await newPage('d-history');
  await login(d,dUid);
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
  // Preserve the original request handles while the contexts are alive.
  // Closing first may lose both the response and the requestfailed event,
  // especially for a read started during the history reconnection.
  await reconcilePendingTransportEvidence(row=>originalContexts.has(row.context),15_000);
  const discovery = [...callableCounts.values()].filter(row=>row.endpoint==='listDirectChatCandidates');
  const discoveryTotal = discovery.reduce((sum,row)=>sum+row.total,0);
  const discovery429 = discovery.reduce((sum,row)=>sum+row.rateLimited,0);
  console.log('Discovery response comparison '+JSON.stringify({
    baseline:60, baseline429:1, actual:discoveryTotal, delta:discoveryTotal-60, rateLimited:discovery429
  }));
  assert.ok(discoveryTotal>0,'Discovery instrumentation captured no requests');
  assert.ok(discoveryTotal<60,'Discovery must improve on the 60-request certified baseline');
  assert.equal(discovery429,0,'Discovery must not exhaust quota in the certified workload');
  const pendingRequests = [...callableCounts.values()].filter(row=>row.endpoint==='getPendingFriendRequests');
  const pendingTotal = pendingRequests.reduce((sum,row)=>sum+row.total,0);
  const pending429 = pendingRequests.reduce((sum,row)=>sum+row.rateLimited,0);
  console.log('Pending friendship reads '+JSON.stringify({total:pendingTotal,rateLimited:pending429,contexts:pendingRequests}));
  assert.ok(pendingTotal>0,'Pending friendship instrumentation captured no requests');
  assert.equal(pending429,0,'Pending friendship reads must not exhaust quota in the certified workload');
  const originalWorkload={discovery:discoveryTotal,pending:pendingTotal};
  assert.equal(pendingRequests.reduce((sum,row)=>sum+row.failed,0),0,'Original pending workload HTTP failures');
  await Promise.all([a.context().close(),b.context().close(),d.context().close()]);
  await reconcilePendingTransportEvidence(row=>originalContexts.has(row.context));
  const originalAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>originalContexts.has(row.context)));
  assert.ok(originalAttempts.started>=pendingTotal,'Attempt counting must include completed responses');
  console.log('Pending friendship original attempt accounting '+JSON.stringify(originalAttempts));
  await certifyFriendshipPair('cancel-decline',['f','g'],['send','cancel','send','decline']);
  await certifyFriendshipPair('offline-accept',['h','i'],['offline-send','accept']);
  await certifySpaLifecycle();
  await certifyResilience();
  await certifyAdaptivePolling();
  await certifyConcurrency();
  // Separate controlled precondition: never add pacing to the six preserved loads.
  // Use a disposable browser context and the real application ledger, not mocked HTTP.
  currentPhase='admission cancellation';
  {
    const page=await newPage(admissionCancellationContext);
    const owner=uid('s');
    const rows=()=>pendingAttempts.filter(row=>row.context===admissionCancellationContext);
    const events=()=>pendingAdmission.filter(row=>row.context===admissionCancellationContext);
    try {
      await page.goto(BASE+'/login');
      const expiresAt=await page.evaluate(async user=>{
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(user));
        const key=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
        const now=Date.now();
        localStorage.setItem('friendship.pending-read-admission.v1',JSON.stringify({[key]:Array(10).fill(now)}));
        return now+65_000;
      },owner);
      await loginFromCurrentPage(page,owner);
      await until('actual waiting admission before logout',()=>events().some(row=>row.event==='waiting'),Boolean,20_000);
      const waiting=events().filter(row=>row.event==='waiting');
      const key=row=>row.document+':'+row.operation+':'+row.direction;
      const waitingKeys=[...new Set(waiting.map(key))];
      assert.ok(waitingKeys.length>0);
      assert.equal(rows().length,0,'Unexpected transport while quota is saturated');
      await logout(page);
      assert.ok(Date.now()<expiresAt,'Logout did not occur during the admission window');
      await until('each observed waiting operation cancelled',()=>waitingKeys.every(id=>events().some(row=>key(row)===id&&row.event==='cancelled')),Boolean,20_000);
      assert.ok(waitingKeys.every(id=>!events().some(row=>key(row)===id&&row.event==='transport-started')));
      await sleep(Math.max(0,expiresAt-Date.now())+5_000);
      assert.equal(rows().length,0,'Cancelled admission started transport after quota renewed');
      Object.assign(admissionCancellationSamples,{waitingOperations:waitingKeys.length,cancelledOperations:waitingKeys.length,transportAttempts:rows().length,observedPastRenewalMs:5_000,controlledLedger:true});
      pass('logout cancels individually traced quota waits before transport and after renewal');
    } finally {
      await page.context().close();
    }
  }
  assert.equal(browserErrors.filter(e=>e.type==='pageerror').length,0,'Unhandled browser exceptions including friendship');
  for(const endpoint of ['getPendingFriendRequests','listDirectChatCandidates']) {
    const rows=[...callableCounts.values()].filter(row=>row.endpoint===endpoint);
    assert.equal(rows.reduce((sum,row)=>sum+row.rateLimited,0),0,'No HTTP 429 including reactive workload: '+endpoint);
  }
  assert.ok(pendingOrigins.some(row=>row.event==='start'&&row.reason==='session'),'Session origin tracing unavailable');
  assert.ok(pendingOrigins.some(row=>row.event==='start'&&row.reason==='canonical-event'),'Canonical origin tracing unavailable');
  assert.equal(pendingOrigins.filter(row=>row.event==='start'&&row.reason==='post-mutation').length,0,'No redundant pending friendship transport after local mutation');
  await reconcilePendingTransportEvidence();
  const terminalAccounting=summarizePendingAttempts(pendingAttempts);
  assert.equal(terminalAccounting.unsettled,0,'Every pending attempt requires terminal transport evidence');
  assert.equal(terminalAccounting.httpFailures,0,'No pending request HTTP failures');
  const fullAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>row.context!==resilienceContext&&row.context!==adaptiveContext&&!concurrencyContexts.has(row.context)));
  const adaptiveAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>row.context===adaptiveContext));
  const concurrencyAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>concurrencyContexts.has(row.context)));
  const resilienceAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>row.context===resilienceContext));
  console.log('Resilience evidence '+JSON.stringify({attempts:resilienceAttempts,samples:resilienceSamples}));
  const complementaryAttempts=summarizePendingAttempts(pendingAttempts.filter(isComplementary));
  const spaAttempts=summarizePendingAttempts(pendingAttempts.filter(row=>row.context===spaContext));
  console.log('Pending friendship SPA accounting '+JSON.stringify({attempts:spaAttempts,stages:spaSamples}));
  console.log('Pending friendship complete attempt accounting '+JSON.stringify(fullAttempts));
  console.log('Friendship reactive measurements '+JSON.stringify({originalWorkload,originalAttempts,complementaryAttempts,fullAttempts,samples:friendshipSamples,
    online:sampleSummary(friendshipSamples.filter(row=>!row.reconnect).flatMap(row=>[row.senderMs,row.receiverMs])),
    reconnect:sampleSummary(friendshipSamples.filter(row=>row.reconnect).map(row=>row.receiverMs))}));
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'PASS',phases,metrics,performanceSamples,historySamples,friendshipSamples,originalWorkload,originalAttempts,complementaryAttempts,spaAttempts,spaSamples,fullAttempts,resilienceAttempts,resilienceSamples,adaptiveAttempts,adaptiveSamples,concurrencyAttempts,concurrencySamples,terminalAccounting,admissionCancellationSamples,baselineComparison:baselineComparison(),
    performanceSummary:{budgetMs:PHASE_BUDGET_MS,sendReceive:sampleSummary(performanceSamples.roundTrips.map(row=>row.ms)),
      conversationSwitch:sampleSummary(performanceSamples.switches.map(row=>row.ms))}},null,2));
} catch(error) {
  writeFileSync(resolve(out,'result.json'),JSON.stringify({status:'FAIL',phases,performanceSamples,historySamples,baselineComparison:baselineComparison(),error:String(error)},null,2));
  for(const {name,page} of pages) await screenshot(page,name+'-failure').catch(()=>{});
  throw error;
} finally {
  await Promise.allSettled([...accountingTasks]);
  writeFileSync(resolve(out,'resilience-samples.json'),JSON.stringify(resilienceSamples,null,2));
  writeFileSync(resolve(out,'adaptive-polling-samples.json'),JSON.stringify(adaptiveSamples,null,2));
  writeFileSync(resolve(out,'concurrency-samples.json'),JSON.stringify(concurrencySamples,null,2));
  writeFileSync(resolve(out,'pending-resource-trace.json'),JSON.stringify(pendingResources,null,2));
  writeFileSync(resolve(out,'shared-friends-watch-trace.json'),JSON.stringify(sharedFriendsTrace,null,2));
  writeFileSync(resolve(out,'shared-friends-watch-samples.json'),JSON.stringify(sharedFriendsSamples,null,2));
  console.log('Shared friends watch samples '+JSON.stringify(sharedFriendsSamples));
  writeFileSync(resolve(out,'pending-admission-trace.json'),JSON.stringify(pendingAdmission,null,2));
  writeFileSync(resolve(out,'admission-cancellation-samples.json'),JSON.stringify(admissionCancellationSamples,null,2));
  console.log('Admission cancellation evidence '+JSON.stringify(admissionCancellationSamples));
  writeFileSync(resolve(out,'pending-read-trace.json'),JSON.stringify(pendingReadTrace,null,2));
  writeFileSync(resolve(out,'pending-read-origins.json'),JSON.stringify(pendingOrigins,null,2));
  writeFileSync(resolve(out,'pending-read-attempts.json'),JSON.stringify(pendingAttempts,null,2));
  const finalAccounting={original:summarizePendingAttempts(pendingAttempts.filter(row=>originalContexts.has(row.context))),complementary:summarizePendingAttempts(pendingAttempts.filter(isComplementary)),spa:summarizePendingAttempts(pendingAttempts.filter(row=>row.context===spaContext)),resilience:summarizePendingAttempts(pendingAttempts.filter(row=>row.context===resilienceContext)),adaptive:summarizePendingAttempts(pendingAttempts.filter(row=>row.context===adaptiveContext)),legacyTotal:summarizePendingAttempts(pendingAttempts.filter(row=>row.context!==resilienceContext&&row.context!==adaptiveContext&&!concurrencyContexts.has(row.context))),previousFour:summarizePendingAttempts(pendingAttempts.filter(row=>row.context!==adaptiveContext&&!concurrencyContexts.has(row.context))),previousFive:summarizePendingAttempts(pendingAttempts.filter(row=>!concurrencyContexts.has(row.context))),concurrency:summarizePendingAttempts(pendingAttempts.filter(row=>concurrencyContexts.has(row.context))),all:summarizePendingAttempts(pendingAttempts)};
  writeFileSync(resolve(out,'pending-read-accounting.json'),JSON.stringify(finalAccounting,null,2));
  console.log('Pending friendship final accounting '+JSON.stringify(finalAccounting));
  console.log('SPA lifecycle stage evidence '+JSON.stringify(spaSamples));
  console.log('Resilience stage evidence '+JSON.stringify(resilienceSamples));
  console.log('Adaptive polling stage evidence '+JSON.stringify(adaptiveSamples));
  console.log('Concurrency stage evidence '+JSON.stringify(concurrencySamples));
  console.log('Pending friendship origins '+JSON.stringify(pendingOrigins.filter(row=>row.event==='start').reduce((counts,row)=>{ const key=row.context+':'+row.direction+':'+row.reason; counts[key]=(counts[key]??0)+1; return counts; },{})));
  writeFileSync(resolve(out,'spa-lifecycle-samples.json'),JSON.stringify(spaSamples,null,2));
  writeFileSync(resolve(out,'friendship-reactive-samples.json'),JSON.stringify(friendshipSamples,null,2));
  writeFileSync(resolve(out,'browser-diagnostics.json'),JSON.stringify(browserErrors,null,2));
  writeFileSync(resolve(out,'callable-counts.json'),JSON.stringify([...callableCounts.values()].sort((a,b)=>b.total-a.total),null,2));
  writeFileSync(resolve(out,'callable-transport-failures.json'),JSON.stringify([...callableTransportFailures.values()].sort((a,b)=>b.total-a.total),null,2));
  writeFileSync(resolve(out,'history-fixture-checks.json'),JSON.stringify(historyFixtureChecks,null,2));
  await browser?.close();
  if(server) server.kill('SIGTERM');
  log.end();
  await deleteApp(sdk);
  await deleteAdminApp(admin);
}
