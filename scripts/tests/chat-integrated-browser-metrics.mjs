// Exact native cancellation codes independently observed in the loopback probe.
// They indicate cancellation, not whether the cancellation was intentional.
const nativeCancellationCodes = new Set(['net::ERR_ABORTED','NS_BINDING_ABORTED','Load request cancelled']);
export function isBrowserTransportCancellation(code) {
  return nativeCancellationCodes.has(code);
}

// Preserve known native codes without persisting arbitrary error text or URLs.
export function browserTransportFailureCategory(code) {
  if (!code) return null;
  return isBrowserTransportCancellation(code) ||
    (typeof code==='string' && /^net::ERR_[A-Z_]+$/.test(code)) ? code : 'other';
}

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
    } else if(isBrowserTransportCancellation(row.transportFailure)) {
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

// Logical RxJS subscriptions only, not physical sockets or billed operations.
export function summarizeSharedFriendsWatch(rows,size) {
  const counter=()=>({opened:0,closed:0,active:0,peak:0});
  const result={listener:counter(),consumer:counter(),hydration:{...counter(),peakPerSnapshot:0},unmatchedCloses:0};
  const balances=new Map();
  for(const row of rows.filter(row=>row.size===size)) {
    const counter=result[row.resource];
    if(!counter) throw new Error('Unknown shared watch resource');
    const key=JSON.stringify([row.entry,row.resource,row.snapshot]);
    const prior=balances.get(key)??0;
    if(row.event==='open') {
      balances.set(key,prior+1);
      counter.opened++;counter.active++;counter.peak=Math.max(counter.peak,counter.active);
      if(row.resource==='hydration')counter.peakPerSnapshot=Math.max(counter.peakPerSnapshot,prior+1);
    } else if(row.event==='close') {
      if(prior===0)result.unmatchedCloses++;
      else {balances.set(key,prior-1);counter.closed++;counter.active--;}
    } else throw new Error('Unknown shared watch event');
  }
  return result;
}

// Omitted configuration preserves the existing Chromium certification.
// Explicit unknown or empty configuration must fail, never fall back silently.
export function resolveBrowserEngine(value = 'chromium') {
  if (!['chromium','firefox','webkit'].includes(value)) {
    throw new Error('Unsupported CHAT_BROWSER_ENGINE');
  }
  return value;
}

// Both authenticated directions must belong to each actual mounted document.
export function mountedDocumentReadsComplete(attempts, mountedDocuments) {
  return mountedDocuments.length>0 && mountedDocuments.every(({context,document})=>
    Number.isInteger(document)&&document>0&&['inbound','outbound'].every(direction=>
      attempts.some(row=>row.context===context&&row.document===document&&row.route==='friends'&&
        row.direction===direction&&row.httpStatus===200)));
}

// Diagnostic only. Match exact URLs in memory; never persist query strings.
// A match is not permission to remove a pageerror from the strict gate.
export function correlateBrowserNetworkErrors(errors, failures) {
  return errors.map(({url,...error})=>{
    const match=failures.filter(row=>row.name===error.name&&row.url===url&&
      Math.abs(row.atMs-error.atMs)<=2000)
      .sort((a,b)=>Math.abs(a.atMs-error.atMs)-Math.abs(b.atMs-error.atMs))[0];
    return {...error,matched:!!match,...(match?{failurePhase:match.phase,
      failureDocument:match.document,deltaMs:Math.round(match.atMs-error.atMs)}:{})};
  });
}

// Installed Chrome/Edge channels share the Chromium engine, not its bundled binary.
export function resolveBrowserChannel(engine, value = '') {
  if (value === '') return undefined;
  if (engine !== 'chromium' || !['chrome','msedge'].includes(value)) {
    throw new Error('Unsupported CHAT_BROWSER_CHANNEL for engine');
  }
  return value;
}
