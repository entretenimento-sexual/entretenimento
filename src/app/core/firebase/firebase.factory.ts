// src/app/core/firebase/firebase.factory.ts
import { Provider, inject } from '@angular/core';
import { FirebaseApp, getApps, initializeApp } from '@angular/fire/app';
import { Auth, browserLocalPersistence, connectAuthEmulator, getAuth, indexedDBLocalPersistence, inMemoryPersistence, setPersistence } from '@angular/fire/auth';
import { connectFirestoreEmulator, Firestore, getFirestore } from '@angular/fire/firestore';

import { FIREBASE_APP, FIREBASE_AUTH, FIREBASE_DB } from './firebase.tokens';
import { environment } from 'src/environments/environment';

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
    { provide: FIREBASE_APP, useFactory: () => inject(FirebaseApp) },
    { provide: FIREBASE_AUTH, useFactory: () => inject(Auth) },
    { provide: FIREBASE_DB, useFactory: () => inject(Firestore) },
  ];
}
