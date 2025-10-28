//src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
import { firstValueFrom } from 'rxjs';
import { EnvironmentInjector } from '@angular/core';

import { RequestsRepo } from './requests.repo';
import { expect as jestExpect } from '@jest/globals';

// ───────────────────────────────────────────────────────────────────────────────
// MOCK de @angular/fire/firestore (in-memory) — transação/refs/timestamps
// ───────────────────────────────────────────────────────────────────────────────
type DocRef = { path: string };
type ColRef = { path: string };

const store = new Map<string, any>();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// materializa serverTimestamp() no momento do write/update (para asserts simples)
const materializeTs = (obj: any) => {
  if (!obj || typeof obj !== 'object') return obj;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && v.__isServerTs) out[k] = Date.now();
    else if (typeof v === 'object') out[k] = materializeTs(v);
    else out[k] = v;
  }
  return out;
};

// jest.mock deve ficar no topo do arquivo (antes de importar o alvo real)
jest.mock('@angular/fire/firestore', () => {
  return {
    // tokens/types exportados (não usados diretamente aqui, mas ajudam TS/jest)
    Timestamp: class { },
    // Helpers
    doc: (_db: any, path: string): DocRef => ({ path }),
    collection: (_db: any, path: string): ColRef => ({ path }),
    serverTimestamp: () => ({ __isServerTs: true }),

    // Leitura simples fora de transação (p/ paths auxiliares)
    async getDoc(ref: DocRef) {
      const data = store.get(ref.path);
      return {
        exists: () => store.has(ref.path),
        data: () => clone(data),
      };
    },

    // Atualização simples fora de transação
    async updateDoc(ref: DocRef, patch: any) {
      if (!store.has(ref.path)) throw new Error('update on missing doc ' + ref.path);
      const cur = store.get(ref.path);
      const next = { ...cur, ...materializeTs(patch) };
      store.set(ref.path, next);
    },

    // Operações usadas no createRequest (não exercitadas aqui, mas mantidas)
    addDoc: async (col: ColRef, data: any) => {
      const id = Math.random().toString(36).slice(2);
      const path = `${col.path}/${id}`;
      store.set(path, materializeTs(data));
      return { id, path };
    },

    // Transação in-memory
    async runTransaction(_db: any, updateFn: (tx: any) => Promise<void> | void) {
      // “snapshot” do estado (bem simples) — em produção, Firestore lida com conflitos
      const pendingWrites: { op: 'set' | 'update'; ref: DocRef; data: any; merge?: boolean }[] = [];

      const tx = {
        async get(ref: DocRef) {
          const data = store.get(ref.path);
          return {
            exists: () => store.has(ref.path),
            data: () => clone(data),
          };
        },
        set(ref: DocRef, data: any, opts?: { merge?: boolean }) {
          pendingWrites.push({ op: 'set', ref, data, merge: !!opts?.merge });
        },
        update(ref: DocRef, patch: any) {
          pendingWrites.push({ op: 'update', ref, data: patch });
        },
      };

      // executa lógica
      await updateFn(tx);

      // commit “atômico”
      for (const w of pendingWrites) {
        if (w.op === 'set') {
          const current = store.get(w.ref.path) || {};
          const next = w.merge ? { ...current, ...materializeTs(w.data) } : materializeTs(w.data);
          store.set(w.ref.path, next);
        } else {
          if (!store.has(w.ref.path)) throw new Error('tx.update on missing doc ' + w.ref.path);
          const cur = store.get(w.ref.path);
          store.set(w.ref.path, { ...cur, ...materializeTs(w.data) });
        }
      }
    },
  };
});

// CooldownRepo dummy (não é usado por acceptRequestBatch)
class FakeCooldownRepo {
  getCooldownRef(_a: string, _b: string) {
    return { path: `cooldown/noop` };
  }
}

describe('RequestsRepo.acceptRequestBatch', () => {
  let repo: RequestsRepo;
  const db: any = {}; // o mock ignora esse valor
  const env = {} as EnvironmentInjector;

  const REQUEST_ID = 'req-1';
  const A = 'alice';
  const B = 'bob';

  beforeEach(() => {
    store.clear();
    repo = new RequestsRepo(db, env, new FakeCooldownRepo() as any);
  });

  it('deve aceitar uma solicitação pending e criar amizade bilateral', async () => {
    // Arrange: request pendente
    store.set(`friendRequests/${REQUEST_ID}`, {
      requesterUid: A,
      targetUid: B,
      status: 'pending',
      createdAt: Date.now(),
    });

    // Precondições
    expect(store.has(`users/${A}/friends/${B}`)).toBeFalsy();
    expect(store.has(`users/${B}/friends/${A}`)).toBeFalsy();

    // Act
    await firstValueFrom(repo.acceptRequestBatch(REQUEST_ID, A, B));

    // Assert: arestas criadas
    const aSide = store.get(`users/${A}/friends/${B}`);
    const bSide = store.get(`users/${B}/friends/${A}`);
    expect(aSide).toBeTruthy();
    expect(bSide).toBeTruthy();
    expect(aSide.friendUid).toBe(B);
    expect(bSide.friendUid).toBe(A);

    // request atualizado
    const req = store.get(`friendRequests/${REQUEST_ID}`);
    expect(req.status).toBe('accepted');
    expect(req.acceptedAt).toBeDefined();
    expect(req.respondedAt).toBeDefined();
    expect(req.updatedAt).toBeDefined();
  });

  it('deve falhar se a solicitação não estiver pendente', async () => {
    // Arrange: status já aceito
    store.set(`friendRequests/${REQUEST_ID}`, {
      requesterUid: A,
      targetUid: B,
      status: 'accepted',
      createdAt: Date.now(),
    });

    // Act + Assert
    await jestExpect(firstValueFrom(repo.acceptRequestBatch(REQUEST_ID, A, B)))
      .rejects
      .toThrow('Solicitação não está pendente.');

  it('deve falhar se os usuários já forem amigos (qualquer lado)', async () => {
    // Arrange: request pendente
    store.set(`friendRequests/${REQUEST_ID}`, {
      requesterUid: A,
      targetUid: B,
      status: 'pending',
      createdAt: Date.now(),
    });
    // já amigos (lado A)
    store.set(`users/${A}/friends/${B}`, {
      friendUid: B,
      since: Date.now(),
      lastInteractionAt: Date.now(),
    });

    // Act + Assert
    await jestExpect(firstValueFrom(repo.acceptRequestBatch(REQUEST_ID, A, B)))
      .rejects
      .toThrow('Vocês já são amigos.');
  });
});
})


