/**
 * c18k compatibility facade. Preserves the original method name while
 * preventing unregistered c18i sessions from reading any jobs.
 * No production endpoints, automatic schedulers or UI integrations.
 */
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

import {
  runOneDurableVideoTriageAuditPage,
} from './admin-video-triage-audit-journal.firestore';
import {
  auditVideoTriageConcurrentPage,
  type VideoTriageConcurrentAuditPage,
} from './admin-video-triage-evidence-audit.firestore';
import type {
  VideoTriageAuditApproval, VideoTriageAuditReport,
} from './admin-video-triage-audit-session.policy';

export interface VideoTriageAuditStepResult {
  checkpoint: string;
  report: VideoTriageAuditReport;
  page: VideoTriageConcurrentAuditPage | null;
  stopped: boolean;
  readFailed: boolean;
}

export async function runOneVideoTriageAuditPage(
  db: Firestore,
  app: App,
  approval: VideoTriageAuditApproval,
  checkpoint: string,
  secret: Buffer,
  clock: () => number = Date.now,
  readPage: typeof auditVideoTriageConcurrentPage = auditVideoTriageConcurrentPage
): Promise<VideoTriageAuditStepResult> {
  const step = await runOneDurableVideoTriageAuditPage(
    db, app, approval, checkpoint, secret, clock, readPage);
  // A stopped or busy run has no new confirmation, so fail closed
  // rather than returning a misleading token or reading without a lease.
  if (!step.checkpoint) {
    throw new Error('Durable journal has no applied checkpoint for resume.');
  }
  return {
    checkpoint: step.checkpoint, report: step.report,
    page: step.page, readFailed: step.readFailed,
    stopped: step.kind !== 'APPLIED' || step.report.status !== 'OPEN',
  };
}
