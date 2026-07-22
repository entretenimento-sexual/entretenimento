// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { EnvironmentInjector } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { vi } from 'vitest';

const { firestoreStore, firestoreMocks } = vi.hoisted(() => {
  vi.resetModules();

  type DocRef = { path: string };
  type ColRef = { path: string };

  const store = new Map<string, any>();

  const materializeTs = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => materializeTs(item));

    const out: any = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      out[key] = item?.__isServerTs ? Date.now() : materializeTs(item);
    }
    return out;
  };

  const doc = vi.fn((_db: unknown, path: string): DocRef => ({ path }));
  const collection = vi.fn(
    (_db: unknown, path: string): ColRef => ({ path })
  );
  const serverTimestamp = vi.fn(() => ({ __isServerTs: true }));

  const addDoc = vi.fn(async (col: ColRef, data: unknown) => {
    const id = Math.random().toString(36).slice(2);
    store.set(`${col.path}/${id}`, materializeTs(data));
    return { id, path: `${col.path}/${id}` };
  });

  const getDoc = vi.fn(async (ref: DocRef) => {
    const data = store.get(ref.path);
    return {
      exists: () => store.has(ref.path),
      data: () => JSON.parse(JSON.stringify(data)),
    };
  });

  const updateDoc = vi.fn(async (ref: DocRef, patch: unknown) => {
    if (!store.has(ref.path)) {
      throw new Error(`update on missing doc ${ref.path}`);
    }

    const current = store.get(ref.path);
    store.set(ref.path, {
      ...current,
      ...materializeTs(patch),
    });
  });

  const runTransaction = vi.fn(
    async (
      _db: unknown,
      updateFn: (tx: {
        get(ref: DocRef): Promise<{
          exists(): boolean;
          data(): any;
        }>;
        set(ref: DocRef, data: unknown, opts?: { merge?: boolean }): void;
        update(ref: DocRef, data: unknown): void;
      }) => Promise<void> | void
    ) => {
      const pendingWrites: Array<{
        op: 'set' | 'update';
        ref: DocRef;
        data: unknown;
        merge?: boolean;
      }> = [];

      const tx = {
        async get(ref: DocRef) {
          const data = store.get(ref.path);
          return {
            exists: () => store.has(ref.path),
            data: () => JSON.parse(JSON.stringify(data)),
          };
        },
        set(ref: DocRef, data: unknown, opts?: { merge?: boolean }) {
          pendingWrites.push({ op: 'set', ref, data, merge: !!opts?.merge });
        },
        update(ref: DocRef, data: unknown) {
          pendingWrites.push({ op: 'update', ref, data });
        },
      };

      await updateFn(tx);

      for (const write of pendingWrites) {
        if (write.op === 'set') {
          const current = store.get(write.ref.path) ?? {};
          const data = materializeTs(write.data);
          store.set(
            write.ref.path,
            write.merge ? { ...current, ...data } : data
          );
          continue;
        }

        if (!store.has(write.ref.path)) {
          throw new Error(`tx.update on missing doc ${write.ref.path}`);
        }

        const current = store.get(write.ref.path);
        store.set(write.ref.path, {
          ...current,
          ...materializeTs(write.data),
        });
      }
    }
  );

  return {
    firestoreStore: store,
    firestoreMocks: {
      doc,
      collection,
      serverTimestamp,
      addDoc,
      getDoc,
      updateDoc,
      runTransaction,
      query: vi.fn(
        (collectionRef: unknown, ...constraints: unknown[]) => ({
          collectionRef,
          constraints,
        })
      ),
      where: vi.fn((field: string, op: string, value: unknown) => ({
        field,
        op,
        value,
      })),
      getDocs: vi.fn(),
      writeBatch: vi.fn(),
      deleteDoc: vi.fn(),
    },
  };
});

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class Firestore {},
  doc: firestoreMocks.doc,
  collection: firestoreMocks.collection,
  serverTimestamp: firestoreMocks.serverTimestamp,
  query: firestoreMocks.query,
  where: firestoreMocks.where,
  getDocs: firestoreMocks.getDocs,
  writeBatch: firestoreMocks.writeBatch,
  deleteDoc: firestoreMocks.deleteDoc,
  addDoc: firestoreMocks.addDoc,
  getDoc: firestoreMocks.getDoc,
  updateDoc: firestoreMocks.updateDoc,
  runTransaction: firestoreMocks.runTransaction,
}));

import { RequestsRepo } from './requests.repo';

class FakeCooldownRepo {
  getCooldownRef() {
    return { path: 'cooldown/noop' };
  }
}

describe('RequestsRepo.acceptRequestBatch', () => {
  let repo: RequestsRepo;

  const db = {} as any;
  const env = {
    runInContext: <T>(fn: () => T) => fn(),
  } as unknown as EnvironmentInjector;

  const requestId = 'req-1';
  const requesterUid = 'alice';
  const targetUid = 'bob';

  beforeEach(() => {
    firestoreStore.clear();
    vi.clearAllMocks();
    repo = new RequestsRepo(db, env, new FakeCooldownRepo() as any);
  });

  it('deve aceitar uma solicitação pendente e criar as duas arestas', async () => {
    firestoreStore.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'pending',
      createdAt: Date.now(),
    });

    await firstValueFrom(repo.acceptRequestBatch(requestId, requesterUid, targetUid));

    const requesterSide = firestoreStore.get(
      `users/${requesterUid}/friends/${targetUid}`
    );
    const targetSide = firestoreStore.get(
      `users/${targetUid}/friends/${requesterUid}`
    );
    const request = firestoreStore.get(`friendRequests/${requestId}`);

    expect(requesterSide.friendUid).toBe(targetUid);
    expect(targetSide.friendUid).toBe(requesterUid);
    expect(request.status).toBe('accepted');
    expect(request.acceptedAt).toBeDefined();
    expect(request.respondedAt).toBeDefined();
    expect(request.updatedAt).toBeDefined();
  });

  it('deve falhar se a solicitação não estiver pendente', async () => {
    firestoreStore.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'accepted',
      createdAt: Date.now(),
    });

    await expect(
      firstValueFrom(repo.acceptRequestBatch(requestId, requesterUid, targetUid))
    ).rejects.toThrow('Solicitação não está pendente.');
  });

  it('deve falhar se os usuários já forem amigos', async () => {
    firestoreStore.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'pending',
      createdAt: Date.now(),
    });

    firestoreStore.set(`users/${requesterUid}/friends/${targetUid}`, {
      friendUid: targetUid,
      since: Date.now(),
      lastInteractionAt: Date.now(),
    });

    await expect(
      firstValueFrom(repo.acceptRequestBatch(requestId, requesterUid, targetUid))
    ).rejects.toThrow('Vocês já são amigos.');
  });
});