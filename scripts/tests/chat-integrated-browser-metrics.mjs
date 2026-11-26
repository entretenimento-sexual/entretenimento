// Client-observed POST attempts, not Firestore operations or billed requests.
// A response followed by a transport error remains a single attempt.
export function summarizePendingAttempts(rows) {
  const counts={started:rows.length,httpResponses:0,httpFailures:0,rateLimited:0,
    abortedBeforeResponse:0,otherFailureBeforeResponse:0,unsettled:0,
    transportFailureAfterResponse:0};
  for(const row of rows) {
    if(Number.isInteger(row.httpStatus)) {
      counts.httpResponses++;
      if(row.httpStatus>=400) counts.httpFailures++;
      if(row.httpStatus===429) counts.rateLimited++;
      if(row.transportFailure) counts.transportFailureAfterResponse++;
    } else if(row.transportFailure==='net::ERR_ABORTED') {
      counts.abortedBeforeResponse++;
    } else if(row.transportFailure) {
      counts.otherFailureBeforeResponse++;
    } else {
      counts.unsettled++;
    }
  }
  return counts;
}

// Read only terminal evidence associated with the original request handle.
// A missing event, closure or deadline does not imply a transport abort.
export async function recoverPendingAttempt(request,row,{onResponse,onFailure,timeoutMs=1500}) {
  if(Number.isInteger(row.httpStatus)||row.transportFailure) return;
  if(request.failure()?.errorText) { onFailure(); return; }
  let timer;
  try {
    const response=await Promise.race([
      Promise.resolve().then(()=>request.response()).catch(()=>null),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),timeoutMs);}),
    ]);
    if(response&&!Number.isInteger(row.httpStatus)) onResponse(response);
    if(request.failure()?.errorText&&!row.transportFailure) onFailure();
  } finally { clearTimeout(timer); }
}
