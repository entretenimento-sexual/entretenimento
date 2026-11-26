import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizePendingAttempts } from './chat-integrated-browser-metrics.mjs';

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
