import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  resolvePublicVideoSignedAccessItem,
  type PublicVideoSignedAccessPorts,
  type PublicVideoSignedAccessRequest,
} from './public-video-access-resolution.firestore';

const NOW = 1_800_000_000_000;
const VIDEO = 'users/owner-1/published/videos/video-1/assets/v1';
const POSTER = 'users/owner-1/published/videos/video-1/posters/v1';
const VIDEO_V2 = 'users/owner-1/published/videos/video-1/assets/v2';

type Document = Record<string, unknown> | null;

function createFixture() {
  const state: { projection: Document; publication: Document } = {
    projection: { visibility: 'PUBLIC', moderationStatus: 'APPROVED' },
    publication: {
      isPublished: true,
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
      publishedStoragePath: VIDEO,
      publishedPosterStoragePath: POSTER,
    },
  };
  const reads: string[] = [];
  const checked: string[] = [];
  const signed: Array<{ path: string; expiresAt: number }> = [];
  const files = new Set([VIDEO, POSTER]);
  const firestore = {
    doc(path: string) {
      return {
        async get() {
          reads.push(path);
          const data = path.startsWith('public_profiles/')
            ? state.projection : state.publication;
          return { exists: data !== null, data: () => data };
        },
      };
    },
  } as unknown as Firestore;
  const ports: PublicVideoSignedAccessPorts = {
    async fileExists(path) {
      checked.push(path);
      return files.has(path);
    },
    async createReadUrl(path, expiresAt) {
      signed.push({ path, expiresAt });
      return `signed:${path}:${expiresAt}`;
    },
  };
  const request: PublicVideoSignedAccessRequest = {
    ownerUid: 'owner-1',
    videoId: 'video-1',
    mode: 'PLAYBACK',
    ownerExposureAllowed: true,
    nowMs: NOW,
    technicalExpiresAt: NOW + 300_000,
    requesterAccessExpiresAtMs: null,
    ownerAccessExpiresAtMs: null,
  };
  const resolve = (overrides: Partial<PublicVideoSignedAccessRequest> = {}) =>
    resolvePublicVideoSignedAccessItem(firestore, { ...request, ...overrides }, ports);
  return { state, reads, checked, signed, files, resolve };
}

describe('public video signed access - comportamento real', () => {
  it('assina somente vídeo e poster da publicação vigente', async () => {
    const f = createFixture();
    const item = await f.resolve();
    assert.equal(item?.url, `signed:${VIDEO}:${NOW + 300_000}`);
    assert.equal(item?.posterUrl, `signed:${POSTER}:${NOW + 300_000}`);
    assert.equal(item?.expiresAt, NOW + 300_000);
    assert.equal(f.reads.length, 2);
    assert.deepEqual(f.signed.map((entry) => entry.path), [VIDEO, POSTER]);
  });

  it('PREVIEW nunca consulta nem assina o arquivo de reprodução', async () => {
    const f = createFixture();
    const item = await f.resolve({ mode: 'PREVIEW' });
    assert.equal(item?.url, null);
    assert.ok(item?.posterUrl);
    assert.deepEqual(f.checked, [POSTER]);
    assert.deepEqual(f.signed.map((entry) => entry.path), [POSTER]);
  });

  it('nega owner indisponível antes de consultar o Firestore', async () => {
    const f = createFixture();
    assert.equal(await f.resolve({ ownerExposureAllowed: false }), null);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.signed, []);
  });

  for (const scenario of [
    { name: 'projeção ausente', change: (f: ReturnType<typeof createFixture>) => {
      f.state.projection = null;
    } },
    { name: 'publicação ausente', change: (f: ReturnType<typeof createFixture>) => {
      f.state.publication = null;
    } },
    { name: 'moderação da projeção revogada', change: (f: ReturnType<typeof createFixture>) => {
      f.state.projection = { ...f.state.projection, moderationStatus: 'FLAGGED' };
    } },
    { name: 'moderação da publicação revogada', change: (f: ReturnType<typeof createFixture>) => {
      f.state.publication = { ...f.state.publication, moderationStatus: 'REJECTED' };
    } },
    { name: 'publicação retirada', change: (f: ReturnType<typeof createFixture>) => {
      f.state.publication = { ...f.state.publication, isPublished: false };
    } },
    { name: 'visibilidade privada', change: (f: ReturnType<typeof createFixture>) => {
      f.state.publication = { ...f.state.publication, visibility: 'PRIVATE' };
    } },
    { name: 'caminho de outro proprietário', change: (f: ReturnType<typeof createFixture>) => {
      f.state.publication = {
        ...f.state.publication,
        publishedStoragePath: 'users/other/published/videos/video-1/assets/v1',
      };
    } },
  ]) {
    it(`não emite URL com ${scenario.name}`, async () => {
      const f = createFixture();
      scenario.change(f);
      assert.equal(await f.resolve(), null);
      assert.deepEqual(f.signed, []);
    });
  }

  it('não emite URL após expiração técnica ou de qualquer conta', async () => {
    for (const overrides of [
      { technicalExpiresAt: NOW },
      { requesterAccessExpiresAtMs: NOW },
      { ownerAccessExpiresAtMs: NOW - 1 },
    ]) {
      const f = createFixture();
      assert.equal(await f.resolve(overrides), null);
      assert.deepEqual(f.signed, []);
    }
  });

  it('usa o menor deadline de autorização para vídeo e poster', async () => {
    const f = createFixture();
    const item = await f.resolve({
      requesterAccessExpiresAtMs: NOW + 90_000,
      ownerAccessExpiresAtMs: NOW + 120_000,
    });
    assert.equal(item?.expiresAt, NOW + 90_000);
    assert.deepEqual(f.signed.map((entry) => entry.expiresAt), [NOW + 90_000, NOW + 90_000]);
  });

  it('falha quando o arquivo de reprodução não existe', async () => {
    const f = createFixture();
    f.files.delete(VIDEO);
    await assert.rejects(f.resolve(), /não foi encontrado no Storage/);
    assert.deepEqual(f.signed, []);
  });

  it('em nova consulta não reutiliza versão antiga ou autorização revogada', async () => {
    const f = createFixture();
    assert.ok((await f.resolve())?.url);
    f.state.publication = { ...f.state.publication, publishedStoragePath: VIDEO_V2 };
    f.files.add(VIDEO_V2);
    assert.equal((await f.resolve())?.url, `signed:${VIDEO_V2}:${NOW + 300_000}`);
    f.state.projection = { ...f.state.projection, moderationStatus: 'HIDDEN' };
    assert.equal(await f.resolve(), null);
    assert.deepEqual(
      f.signed.filter((entry) => entry.path.includes('/assets/')).map((entry) => entry.path),
      [VIDEO, VIDEO_V2]
    );
  });
});
