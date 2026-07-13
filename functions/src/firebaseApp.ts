// functions/src/firebaseApp.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

export const adminApp = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
export const storage = getStorage(adminApp);

function cleanBucketName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/, '');
}

function readFirebaseConfigStorageBucket(): string {
  const rawConfig = String(process.env.FIREBASE_CONFIG ?? '').trim();

  if (!rawConfig) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawConfig) as { storageBucket?: unknown };
    return cleanBucketName(parsed.storageBucket);
  } catch {
    return '';
  }
}

export function resolveDefaultStorageBucketName(): string {
  const configuredBucket =
    cleanBucketName(adminApp.options.storageBucket) ||
    cleanBucketName(process.env.FIREBASE_STORAGE_BUCKET) ||
    cleanBucketName(process.env.STORAGE_BUCKET) ||
    readFirebaseConfigStorageBucket();

  if (configuredBucket) {
    return configuredBucket;
  }

  const projectId =
    String(
      adminApp.options.projectId ??
        process.env.GCLOUD_PROJECT ??
        process.env.GCP_PROJECT ??
        ''
    ).trim();

  if (!projectId) {
    throw new Error('Bucket padrão do Firebase Storage não configurado.');
  }

  return `${projectId}.appspot.com`;
}

export function getDefaultStorageBucket() {
  return storage.bucket(resolveDefaultStorageBucketName());
}

export { FieldValue, Timestamp };
