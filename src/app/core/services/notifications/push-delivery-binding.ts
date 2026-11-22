// O service worker lê o mesmo registro local antes de exibir um aviso.
import { createPushInstallationId } from './push-notification-device.policy';

interface PushDeliveryBinding {
  uid: string;
  id: string;
}

const DATABASE = 'entretenimento-web-push';
const STORE = 'delivery';
const KEY = 'active';

export async function updatePushDeliveryBinding(
  update: (current: PushDeliveryBinding | undefined) => PushDeliveryBinding | null | undefined
): Promise<PushDeliveryBinding | null | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.get(KEY);
      let next: PushDeliveryBinding | null | undefined;
      request.onsuccess = () => {
        try {
          next = update(request.result);
          if (next === null) store.delete(KEY);
          else if (next) store.put(next, KEY);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.oncomplete = () => resolve(next);
      transaction.onabort = () => reject(transaction.error ?? new Error('Vínculo Web Push não atualizado.'));
    });
  } finally {
    db.close();
  }
}

export function createPushDeliveryBinding(uid: string): PushDeliveryBinding {
  return { uid, id: createPushInstallationId(globalThis.crypto) };
}
