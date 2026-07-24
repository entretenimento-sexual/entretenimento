// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { EnvironmentInjector } from '@angular/core';
import { firstValueFrom } from 'rxjs';

const firestoreTest = vi.hoisted(() => {
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

  return {
    store,
    materializeTs,
    doc: (_db: unknown, path: string): DocRef => ({ path }),
    collection: (_db: unknown, path: string): ColRef => ({ path }),
  };
});

vi.mock('@angular/fire/firestore', () => ({
  Timestamp: class {},
  Firestore: class {},
  doc: firestoreTest.doc,
  collection: firestoreTest.collection,
  serverTimestamp: () => ({ __isServerTs: true }),
  query: vi.fn((collectionRef: unknown, ...constraints: unknown[]) => ({
    collectionRef,
    constraints,
  })),
  where: vi.fn((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  })),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  deleteDoc: vi.fn(),
  addDoc: async (col: { path: string }, data: unknown) => {
    const id = Math.random().toString(36).slice(2);
    firestoreTest.store.set(
      `${col.path}/${id}`,
      firestoreTest.materializeTs(data)
    );
    return { id, path: `${col.path}/${id}` };
  },
  async getDoc(ref: { path: string }) {
    const data = firestoreTest.store.get(ref.path);
    return {
      exists: () => firestoreTest.store.has(ref.path),
      data: () => JSON.parse(JSON.stringify(data)),
    };
  },
  async updateDoc(ref: { path: string }, patch: unknown) {
    if (!firestoreTest.store.has(ref.path)) {
      throw new Error(`update on missing doc ${ref.path}`);
    }

    const current = firestoreTest.store.get(ref.path);
    firestoreTest.store.set(ref.path, {
      ...current,
      ...firestoreTest.materializeTs(patch),
    });
  },
  async runTransaction(
    _db: unknown,
    updateFn: (tx: unknown) => Promise<void> | void
  ) {
    const pendingWrites: Array<{
      op: 'set' | 'update';
      ref: { path: string };
      data: unknown;
      merge?: boolean;
    }> = [];

    const tx = {
      async get(ref: { path: string }) {
        const data = firestoreTest.store.get(ref.path);
        return {
          exists: () => firestoreTest.store.has(ref.path),
          data: () => JSON.parse(JSON.stringify(data)),
        };
      },
      set(
        ref: { path: string },
        data: unknown,
        opts?: { merge?: boolean }
      ) {
        pendingWrites.push({
          op: 'set',
          ref,
          data,
          merge: !!opts?.merge,
        });
      },
      update(ref: { path: string }, data: unknown) {
        pendingWrites.push({ op: 'update', ref, data });
      },
    };

    await updateFn(tx);

    for (const write of pendingWrites) {
      if (write.op === 'set') {
        const current = firestoreTest.store.get(write.ref.path) ?? {};
        const data = firestoreTest.materializeTs(write.data);
        firestoreTest.store.set(
          write.ref.path,
          write.merge ? { ...current, ...data } : data
        );
        continue;
      }

      if (!firestoreTest.store.has(write.ref.path)) {
        throw new Error(`tx.update on missing doc ${write.ref.path}`);
      }

      const current = firestoreTest.store.get(write.ref.path);
      firestoreTest.store.set(write.ref.path, {
        ...current,
        ...firestoreTest.materializeTs(write.data),
      });
    }
  },
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
    firestoreTest.store.clear();
    repo = new RequestsRepo(db, env, new FakeCooldownRepo() as any);
  });

  it('deve aceitar uma solicitação pendente e criar as duas arestas', async () => {
    firestoreTest.store.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'pending',
      createdAt: Date.now(),
    });

    await firstValueFrom(
      repo.acceptRequestBatch(requestId, requesterUid, targetUid)
    );

    const requesterSide = firestoreTest.store.get(
      `users/${requesterUid}/friends/${targetUid}`
    );
    const targetSide = firestoreTest.store.get(
      `users/${targetUid}/friends/${requesterUid}`
    );
    const request = firestoreTest.store.get(`friendRequests/${requestId}`);

    expect(requesterSide.friendUid).toBe(targetUid);
    expect(targetSide.friendUid).toBe(requesterUid);
    expect(request.status).toBe('accepted');
    expect(request.acceptedAt).toBeDefined();
    expect(request.respondedAt).toBeDefined();
    expect(request.updatedAt).toBeDefined();
  });

  it('deve falhar se a solicitação não estiver pendente', async () => {
    firestoreTest.store.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'accepted',
      createdAt: Date.now(),
    });

    await expect(
      firstValueFrom(
        repo.acceptRequestBatch(requestId, requesterUid, targetUid)
      )
    ).rejects.toThrow('Solicitação não está pendente.');
  });

  it('deve falhar se os usuários já forem amigos', async () => {
    firestoreTest.store.set(`friendRequests/${requestId}`, {
      requesterUid,
      targetUid,
      status: 'pending',
      createdAt: Date.now(),
    });

    firestoreTest.store.set(
      `users/${requesterUid}/friends/${targetUid}`,
      {
        friendUid: targetUid,
        since: Date.now(),
        lastInteractionAt: Date.now(),
      }
    );

    await expect(
      firstValueFrom(
        repo.acceptRequestBatch(requestId, requesterUid, targetUid)
      )
    ).rejects.toThrow('Vocês já são amigos.');
  });
});