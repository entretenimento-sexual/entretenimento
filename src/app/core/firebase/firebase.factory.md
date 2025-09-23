# src\app\core\firebase\firebase.factory.md
# 🔥 firebase.factory.ts — Inicialização Única e Antecipada do Firebase no Angular

Este documento explica **por que** e **como** usamos `firebase.factory.ts` para inicializar o Firebase **uma única vez**, **antes** do app subir, de forma **tolerante a mudanças** do SDK e **fácil de evoluir**.

---

## 🎯 Objetivos

- **Instância única** do `FirebaseApp`, `Auth` e `Firestore` via **Injeção de Dependência (DI)**.
- **Bootstrap antecipado**: tudo pronto **antes** do primeiro `onAuthStateChanged`.
- **Persistência configurada** do Auth (IndexedDB → LocalStorage → Memória).
- **Compatibilidade** com partes do app que ainda usam **AngularFire compat**.
- Suporte a **Emulators** em dev, sem tocar em cada serviço.

---

## 🧩 O que o arquivo expõe

```ts
// src/app/core/firebase/firebase.factory.ts (resumo conceitual)

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, indexedDBLocalPersistence, inMemoryPersistence, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';

import { Provider } from '@angular/core';
import { environment } from 'src/environments/environment';
import { FIREBASE_APP, FIREBASE_AUTH, FIREBASE_DB } from './firebase.tokens';

// 1) Garante que o App exista (reusa se já houver)
function initFirebaseApp(): FirebaseApp {
  return getApps()[0] ?? initializeApp(environment.firebase);
}

// 2) Cria o Auth, conecta em emulador em dev
function initAuth(app: FirebaseApp): Auth {
  const auth = getAuth(app);
  const emu = (environment as any)?.emulators?.auth;
  if (!environment.production && emu?.host && emu?.port) {
    connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
  }
  return auth;
}

// 3) Cria o Firestore, conecta em emulador em dev
function initDb(app: FirebaseApp): Firestore {
  const db = getFirestore(app);
  const emu = (environment as any)?.emulators?.firestore;
  if (!environment.production && emu?.host && emu?.port) {
    connectFirestoreEmulator(db, emu.host, emu.port);
  }
  return db;
}

// 4) Configura PERSISTÊNCIA do Auth (IndexedDB -> LocalStorage -> Memória)
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

// 5) Registra provedores para DI no Angular
export function provideFirebase(): Provider[] {
  return [
    { provide: FIREBASE_APP, useFactory: initFirebaseApp },
    { provide: FIREBASE_AUTH, deps: [FIREBASE_APP], useFactory: initAuth },
    { provide: FIREBASE_DB,   deps: [FIREBASE_APP], useFactory: initDb  },
  ];
}

Boas práticas que o factory habilita

Inicialização única → menos bugs, menos “race conditions”.

Persistência configurada cedo → sessão não “evapora”.

Evolução futura (novas versões do SDK) → ajuste centralizado.

Observabilidade → um único ponto para logs/telemetria de inicialização.

Testabilidade → tokens DI facilitam mocks em testes unitários.
