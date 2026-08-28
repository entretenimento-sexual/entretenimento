import {
  connectAuthEmulator,
  type Auth,
} from '@angular/fire/auth';
import {
  connectFirestoreEmulator,
  type Firestore,
} from '@angular/fire/firestore';
import {
  connectFunctionsEmulator,
  type Functions,
} from '@angular/fire/functions';
import {
  connectDatabaseEmulator,
  type Database,
} from 'firebase/database';
import {
  connectStorageEmulator,
  type FirebaseStorage,
} from 'firebase/storage';
import type { EmulatorEndpoint } from '../../../environments/environment.model';

const connectedAuthInstances = new WeakSet<object>();
const connectedFirestoreInstances = new WeakSet<object>();
const connectedDatabaseInstances = new WeakSet<object>();
const connectedStorageInstances = new WeakSet<object>();
const connectedFunctionsInstances = new WeakSet<object>();

function connectOnce<T extends object>(
  connectedInstances: WeakSet<object>,
  instance: T,
  connect: () => void
): void {
  if (connectedInstances.has(instance)) return;

  connect();
  connectedInstances.add(instance);
}

export function connectAuthEmulatorSafely(
  auth: Auth,
  endpoint: EmulatorEndpoint
): void {
  connectOnce(connectedAuthInstances, auth, () => {
    connectAuthEmulator(
      auth,
      `http://${endpoint.host}:${endpoint.port}`,
      { disableWarnings: true }
    );
  });
}

export function connectFirestoreEmulatorSafely(
  firestore: Firestore,
  endpoint: EmulatorEndpoint
): void {
  connectOnce(connectedFirestoreInstances, firestore, () => {
    connectFirestoreEmulator(firestore, endpoint.host, endpoint.port);
  });
}

export function connectDatabaseEmulatorSafely(
  database: Database,
  endpoint: EmulatorEndpoint
): void {
  connectOnce(connectedDatabaseInstances, database, () => {
    connectDatabaseEmulator(database, endpoint.host, endpoint.port);
  });
}

export function connectStorageEmulatorSafely(
  storage: FirebaseStorage,
  endpoint: EmulatorEndpoint
): void {
  connectOnce(connectedStorageInstances, storage, () => {
    connectStorageEmulator(storage, endpoint.host, endpoint.port);
  });
}

export function connectFunctionsEmulatorSafely(
  functions: Functions,
  endpoint: EmulatorEndpoint
): void {
  connectOnce(connectedFunctionsInstances, functions, () => {
    connectFunctionsEmulator(functions, endpoint.host, endpoint.port);
  });
}
