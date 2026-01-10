// functions/src/firebaseApp.ts
import { getApps, getApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

export const adminApp = getApps().length ? getApp() : initializeApp();
export const db = getFirestore(adminApp);
export const auth = getAuth(adminApp);
export const storage = getStorage(adminApp);

export { FieldValue, Timestamp };
