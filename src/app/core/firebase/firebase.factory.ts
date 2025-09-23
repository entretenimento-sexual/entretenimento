//src\app\core\firebase\firebase.factory.ts
import { Provider } from '@angular/core';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth, setPersistence, indexedDBLocalPersistence,
         browserLocalPersistence, inMemoryPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { environment } from 'src/environments/environment';
import { FIREBASE_APP, FIREBASE_AUTH, FIREBASE_DB } from './firebase.tokens';

function initFirebaseApp(): FirebaseApp {
  return getApps()[0] ?? initializeApp(environment.firebase);
}

export async function configureAuthPersistence(auth: Auth): Promise<void> {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {
      await setPersistence(auth, inMemoryPersistence);
    }
  }
}

function initAuth(app: FirebaseApp): Auth {
  const auth = getAuth(app);
  const cfg: any = environment;
  const emu = cfg?.emulators?.auth;
  if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
    connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
  }
  configureAuthPersistence(auth).catch(() => { });
  return auth;
}

function initDb(app: FirebaseApp): Firestore {
  const db = getFirestore(app);
  const cfg: any = environment;
  const emu = cfg?.emulators?.firestore;
  if (!environment.production && cfg?.useEmulators && emu?.host && emu?.port) {
    connectFirestoreEmulator(db, emu.host, emu.port);
  }
  return db;
}

export function provideFirebase(): Provider[] {
  return [
    { provide: FIREBASE_APP, useFactory: initFirebaseApp },
    { provide: FIREBASE_AUTH, deps: [FIREBASE_APP], useFactory: initAuth },
    { provide: FIREBASE_DB, deps: [FIREBASE_APP], useFactory: initDb },
  ];
}
