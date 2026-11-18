import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(host)) {
  throw new Error('Informe o endereço do emulador local em FIRESTORE_EMULATOR_HOST.');
}
process.env.FIRESTORE_EMULATOR_HOST = host;

const config = JSON.parse(readFileSync(new URL('../../.firebaserc', import.meta.url), 'utf8'));
const projectId = process.env.FIREBASE_PROJECT_ID || config.projects.dev;
const app = initializeApp({ projectId });
try {
  const db = getFirestore(app);
  const obsolete = db.collection('nickname_reservations');
  await db.recursiveDelete(obsolete);
  if (!(await obsolete.limit(1).get()).empty) {
    throw new Error('A coleção obsoleta ainda contém documentos no emulador.');
  }
  console.log('Coleção nickname_reservations removida do emulador de desenvolvimento.');
} finally {
  await deleteApp(app);
}
