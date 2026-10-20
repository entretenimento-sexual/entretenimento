/**
 * c18h: authenticated, opt-in, one-page Firestore Admin REST preflight.
 * No production invocation, deployment, scheduler, callable, pagination loop
 * or automatic permission to enable global triage.
 */
import type { App } from 'firebase-admin/app';
import {
  evaluateVideoTriageReadiness,
  type VideoTriageIndexDescription, type VideoTriageIndexEvidence,
  type VideoTriageReadinessResult,
} from './admin-video-triage-readiness.policy';

export const TRIAGE_INDEX_METADATA_PAGE_SIZE = 100;
export const TRIAGE_INDEX_METADATA_BYTE_LIMIT = 256_000;
export const TRIAGE_INDEX_METADATA_TIMEOUT_MS = 5_000;
const COLLECTION = 'media_video_processing_jobs';
const DATABASE = '(default)';

export interface TriageIndexReadApproval {
  approved: true;
  purpose: 'READ_ONLY_TRIAGE_INDEX_PREFLIGHT';
  expectedProjectId: string;
  expectedDatabaseId: '(default)';
}

export interface AuthenticatedTriageIndexPage {
  scope: 'INDEX_METADATA_PAGE_ONLY';
  source: 'FIRESTORE_ADMIN_API';
  projectId: string;
  databaseId: '(default)';
  observedAt: number;
  hasMore: boolean;
  indexCount: number;
  /** Never emitted from truncated index lists. */
  indexEvidence: VideoTriageIndexEvidence | null;
  readiness: VideoTriageReadinessResult;
  maxMetadataRequests: 1;
  maxDocumentReads: 0;
  maxWrites: 0;
}

function parent(project: string): string {
  return 'projects/' + project + '/databases/' + DATABASE +
    '/collectionGroups/' + COLLECTION + '/indexes';
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Provider metadata validation; never accept another project/database. */
export function parseAuthenticatedTriageIndexPage(
  input: unknown, project: string
): { indexes: VideoTriageIndexDescription[]; hasMore: boolean } {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(project) || !record(input)) {
    throw new Error('Invalid index metadata envelope.');
  }
  const source = input.indexes ?? [];
  if (!Array.isArray(source) || source.length > TRIAGE_INDEX_METADATA_PAGE_SIZE ||
      (input.nextPageToken !== undefined &&
        (typeof input.nextPageToken !== 'string' ||
          input.nextPageToken.length > 2_048))) {
    throw new Error('Invalid or unbounded index metadata.');
  }
  const prefix = parent(project) + '/';
  const indexes: VideoTriageIndexDescription[] = [];
  for (const item of source) {
    if (!record(item) || typeof item.name !== 'string' ||
        !item.name.startsWith(prefix) ||
        !/^[A-Za-z0-9_-]+$/.test(item.name.slice(prefix.length)) ||
        typeof item.queryScope !== 'string' ||
        typeof item.state !== 'string' ||
        !Array.isArray(item.fields) || item.fields.length > 12) {
      throw new Error('Cross-project or malformed index metadata.');
    }
    const fields: VideoTriageIndexDescription['fields'] = [];
    for (const field of item.fields) {
      if (!record(field) || typeof field.fieldPath !== 'string' ||
          typeof field.order !== 'string') {
        throw new Error('Invalid index field.');
      }
      fields.push({ fieldPath: field.fieldPath, order: field.order });
    }
    indexes.push({
      collectionGroup: COLLECTION, queryScope: item.queryScope,
      state: item.state, fields,
    });
  }
  return { indexes, hasMore: !!input.nextPageToken };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const size = response.headers.get('content-length');
  if (size && Number(size) > TRIAGE_INDEX_METADATA_BYTE_LIMIT) {
    throw new Error('Index metadata response exceeds byte budget.');
  }
  if (!response.body) throw new Error('Missing index metadata response body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TRIAGE_INDEX_METADATA_BYTE_LIMIT) {
        await reader.cancel();
        throw new Error('Index metadata response exceeds byte budget.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = Buffer.concat(chunks);
  return JSON.parse(merged.toString('utf8')) as unknown;
}

/**
 * Credentials are sourced from the explicitly supplied Firebase Admin app,
 * not from a user JSON claim. Fixed Firestore REST endpoint, OAuth token and
 * no redirects. Emulator is rejected. No second page is requested.
 */
export async function readAuthenticatedTriageIndexPage(
  app: App, approval: TriageIndexReadApproval, now = Date.now()
): Promise<AuthenticatedTriageIndexPage> {
  const project = app.options.projectId;
  if (!approval || approval.approved !== true ||
      approval.purpose !== 'READ_ONLY_TRIAGE_INDEX_PREFLIGHT' ||
      approval.expectedDatabaseId !== DATABASE ||
      typeof project !== 'string' ||
      !/^[a-z][a-z0-9-]{4,62}$/.test(project) ||
      approval.expectedProjectId !== project ||
      !app.options.credential ||
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('Authenticated index preflight not authorized.');
  }
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new RangeError('Invalid index metadata read clock.');
  }
  const token = await app.options.credential.getAccessToken();
  if (!token || typeof token.access_token !== 'string' ||
      !token.access_token.trim()) {
    throw new Error('Authenticated Firebase Admin credential unavailable.');
  }
  const url = 'https://firestore.googleapis.com/v1/' + parent(project) +
    '?pageSize=' + TRIAGE_INDEX_METADATA_PAGE_SIZE;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + token.access_token,
      Accept: 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(TRIAGE_INDEX_METADATA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Index metadata HTTP ' + response.status);
  const { indexes, hasMore } = parseAuthenticatedTriageIndexPage(
    await readBoundedJson(response), project);
  const indexEvidence: VideoTriageIndexEvidence | null = hasMore ? null : {
    source: 'FIRESTORE_ADMIN_API', environment: 'PRODUCTION',
    observedAt: now, indexes,
  };
  return {
    scope: 'INDEX_METADATA_PAGE_ONLY', source: 'FIRESTORE_ADMIN_API',
    projectId: project, databaseId: DATABASE, observedAt: now,
    hasMore, indexCount: indexes.length, indexEvidence,
    // Even actual READY index metadata cannot prove eight other conditions.
    readiness: evaluateVideoTriageReadiness(
      indexEvidence ? { indexes: indexEvidence } : null, now),
    maxMetadataRequests: 1, maxDocumentReads: 0, maxWrites: 0,
  };
}
