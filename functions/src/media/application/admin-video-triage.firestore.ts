import { FieldValue } from 'firebase-admin/firestore';

import type { VideoProcessingJob } from './video-processing-job';
import { projectAdminTriageJob } from './admin-video-global-triage.policy';

const TRIAGE_FIELDS = [
  'adminTriageProjectionVersion', 'adminTriageProcessingVersion',
  'adminTriageTier', 'adminTriageSince', 'adminTriageReevaluateAt',
] as const;

/**
 * Materialize from the same version-fenced after-image that the caller writes.
 * The caller must read and fence the current job before this same transaction
 * commits; this helper itself never reads Firestore or the Transcoder.
 * Terminal and invalid-version jobs erase every indexed projection field.
 */
export function withAdminTriageProjection<T extends object>(
  jobId: string, current: Partial<VideoProcessingJob> | null,
  patch: T, now: number
): T & Record<string, unknown> {
  const next = { ...(current ?? {}), ...patch } as Partial<VideoProcessingJob>;
  const projected = projectAdminTriageJob(jobId, next, now);
  const fields: Record<string, unknown> = {};
  if (projected) Object.assign(fields, projected);
  else for (const field of TRIAGE_FIELDS) fields[field] = FieldValue.delete();
  return { ...patch, ...fields };
}
