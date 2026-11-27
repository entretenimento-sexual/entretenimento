import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizePendingAttempts, recoverPendingAttempt, mountedDocumentReadsComplete, correlateBrowserNetworkErrors } from './chat-integrated-browser-metrics.mjs';

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
test('does not replace already-recorded terminal evidence',async()=>{
  const row={httpStatus:200,transportFailure:null};
  const request={failure:()=>{throw Error('must not query settled request');},response:()=>{throw Error('must not query settled request');}};
  await recoverPendingAttempt(request,row,callbacks(row,request));
  assert.equal(row.httpStatus,200);
});

test('requires both directions in each actual mounted document independent of navigation ordinal',()=>{
  const mounted=[{context:'sender',document:3},{context:'receiver',document:4}];
  const rows=mounted.flatMap(row=>['inbound','outbound'].map(direction=>({...row,route:'friends',direction,httpStatus:200})));
  assert.equal(mountedDocumentReadsComplete(rows,mounted),true);
  assert.equal(mountedDocumentReadsComplete(rows.map(row=>({...row,document:2})),mounted),false);
  assert.equal(mountedDocumentReadsComplete(rows.slice(0,-1),mounted),false);
  assert.equal(mountedDocumentReadsComplete(rows.map(row=>({...row,route:'login'})),mounted),false);
  assert.equal(mountedDocumentReadsComplete(rows.map(row=>({...row,httpStatus:429})),mounted),false);
  assert.equal(mountedDocumentReadsComplete([],[]),false);
});
test('correlates only exact local URL and context without serializing session query strings',()=>{
  const error={name:'a',phase:'navigation',document:2,atMs:1000,url:'http://127.0.0.1:18080/listen?SID=secret',endpoint:'http://127.0.0.1:18080/listen'};
  const failure={...error,document:1,atMs:1010};
  const [match]=correlateBrowserNetworkErrors([error],[failure]);
  assert.equal(match.matched,true);
  assert.equal(match.failureDocument,1);
  assert.equal(JSON.stringify(match).includes('secret'),false);
  assert.equal(correlateBrowserNetworkErrors([error],[{...failure,url:failure.url+'2'}])[0].matched,false);
  assert.equal(correlateBrowserNetworkErrors([error],[{...failure,name:'b'}])[0].matched,false);
  assert.equal(correlateBrowserNetworkErrors([error],[{...failure,atMs:4000}])[0].matched,false);
});
