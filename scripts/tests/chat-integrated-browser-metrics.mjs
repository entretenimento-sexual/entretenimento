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
