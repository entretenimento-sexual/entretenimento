import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizePendingAttempts, recoverPendingAttempt, summarizeSharedFriendsWatch, resolveBrowserEngine } from './chat-integrated-browser-metrics.mjs';

test('counts starts even when navigation aborts before HTTP response',()=>{
  const rows=[{httpStatus:200},{httpStatus:200},{httpStatus:null,transportFailure:'net::ERR_ABORTED'}];
  assert.deepEqual(summarizePendingAttempts(rows),{started:3,httpResponses:2,httpFailures:0,rateLimited:0,
    abortedBeforeResponse:1,otherFailureBeforeResponse:0,unsettled:0,transportFailureAfterResponse:0});
});
test('partitions attempts without double counting a response followed by abort',()=>{
  const result=summarizePendingAttempts([
    {httpStatus:429},{httpStatus:500},{httpStatus:200,transportFailure:'net::ERR_ABORTED'},
    {httpStatus:null,transportFailure:'net::ERR_ABORTED'},
    {httpStatus:null,transportFailure:'net::ERR_CONNECTION_RESET'},{httpStatus:null},
  ]);
  assert.equal(result.started,6);
  assert.equal(result.httpResponses,3);
  assert.equal(result.httpFailures,2);
  assert.equal(result.rateLimited,1);
  assert.equal(result.transportFailureAfterResponse,1);
  assert.equal(result.abortedBeforeResponse,1);
  assert.equal(result.otherFailureBeforeResponse,1);
  assert.equal(result.unsettled,1);
  assert.equal(result.started,result.httpResponses+result.abortedBeforeResponse+result.otherFailureBeforeResponse+result.unsettled);
});
test('empty workload is not mistaken for success or a completed call',()=>{
  const result=summarizePendingAttempts([]);
  assert.equal(result.started,0);
  assert.equal(result.httpResponses,0);
  assert.equal(result.unsettled,0);
});

const attempt=()=>({httpStatus:null,transportFailure:null});
const callbacks=(row,request)=>({
  onResponse: response=>{row.httpStatus=response.status();},
  onFailure: ()=>{row.transportFailure=request.failure().errorText;},
  timeoutMs:10,
});
test('recovers the exact request HTTP response',async()=>{
  const row=attempt();
  const request={failure:()=>null,response:async()=>({status:()=>200})};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(summarizePendingAttempts([row]).httpResponses,1);
  assert.equal(summarizePendingAttempts([row]).unsettled,0);
});
test('recovers a confirmed request failure',async()=>{
  const row=attempt();
  const request={failure:()=>({errorText:'net::ERR_ABORTED'}),response:async()=>null};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(summarizePendingAttempts([row]).abortedBeforeResponse,1);
});
test('context closure and rejected response do not manufacture evidence',async()=>{
  const row={...attempt(),contextClosedWithoutTerminalEvent:true};
  const request={failure:()=>null,response:async()=>{throw Error('context closed');}};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(summarizePendingAttempts([row]).unsettled,1);
});
test('bounded wait preserves an unknown outcome',async()=>{
  const row=attempt();
  const request={failure:()=>null,response:()=>new Promise(()=>{})};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(summarizePendingAttempts([row]).unsettled,1);
});
test('allows a live request to deliver delayed terminal evidence within the explicit budget',async()=>{
  const row=attempt();
  const request={failure:()=>null,response:()=>new Promise(resolve=>setTimeout(()=>resolve({status:()=>200}),20))};
  await recoverPendingAttempt(request,row,{...callbacks(row,request),timeoutMs:500});
  assert.equal(summarizePendingAttempts([row]).httpResponses,1);
  assert.equal(summarizePendingAttempts([row]).unsettled,0);
});
test('does not replace already-recorded terminal evidence',async()=>{
  const row={httpStatus:200,transportFailure:null};
  const request={failure:()=>{throw Error('must not query settled request');},response:()=>{throw Error('must not query settled request');}};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(row.httpStatus,200);
});

test('counts shared logical resources and independent sequential hydrations',()=>{
  const row=(resource,event,snapshot=0,entry=1,size=24)=>({resource,event,snapshot,entry,size});
  const result=summarizeSharedFriendsWatch([
    row('consumer','open'),row('listener','open'),row('consumer','open'),
    row('hydration','open',1),row('hydration','close',1),row('hydration','open',1),row('hydration','close',1),
    row('consumer','close'),row('consumer','close'),row('listener','close'),row('listener','open',0,2,48)
  ],24);
  assert.equal(result.listener.peak,1);assert.equal(result.consumer.peak,2);
  assert.equal(result.hydration.opened,2);assert.equal(result.hydration.peakPerSnapshot,1);
  assert.equal(result.unmatchedCloses,0);assert.equal(result.listener.active,0);assert.equal(result.consumer.active,0);
});
test('exposes duplicate hydration, overlapping listeners and unmatched closes',()=>{
  const row=(resource,event,snapshot=0,entry=1)=>({resource,event,snapshot,entry,size:24});
  const result=summarizeSharedFriendsWatch([row('listener','open'),row('listener','open',0,2),
    row('hydration','open',1),row('hydration','open',1),row('consumer','close')],24);
  assert.equal(result.listener.peak,2);assert.equal(result.hydration.peakPerSnapshot,2);assert.equal(result.unmatchedCloses,1);
});

test('selects supported browser engines without changing the Chromium default',()=>{
  assert.equal(resolveBrowserEngine(),'chromium');
  for(const engine of ['chromium','firefox','webkit']) assert.equal(resolveBrowserEngine(engine),engine);
});
test('rejects explicit unsupported browser configuration instead of silently using Chromium',()=>{
  for(const engine of ['',null,'edge','safari','Chromium',' chromium ']) assert.throws(()=>resolveBrowserEngine(engine),/Unsupported CHAT_BROWSER_ENGINE/);
});
