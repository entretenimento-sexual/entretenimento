import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPublicVideoHlsBundle } from './public-video-hls-manifest.service';

const MASTER_PATH =
  'users/owner-1/processed/videos/video-1/run-1/manifest.m3u8';
const SD_PATH =
  'users/owner-1/processed/videos/video-1/run-1/media-sd.m3u8';
const HD_PATH =
  'users/owner-1/processed/videos/video-1/run-1/media-hd.m3u8';

function fixtureReader(files: Record<string, string>) {
  return async (storagePath: string): Promise<string> => {
    const content = files[storagePath];

    if (!content) {
      throw new Error(`fixture ausente: ${storagePath}`);
    }

    return content;
  };
}

test('reescreve playlists e segmentos sem expor caminhos do Storage', async () => {
  const signedPaths: string[] = [];
  const bundle = await buildPublicVideoHlsBundle({
    masterStoragePath: MASTER_PATH,
    expiresAt: Date.now() + 30 * 60_000,
    readTextFile: fixtureReader({
      [MASTER_PATH]: [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360',
        'media-sd.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1280x720',
        'media-hd.m3u8',
      ].join('\n'),
      [SD_PATH]: [
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:6',
        '#EXTINF:6.0,',
        'media-sd0000000000.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      [HD_PATH]: [
        '#EXTM3U',
        '#EXT-X-MAP:URI="video-init.m4s"',
        '#EXTINF:6.0,',
        'video-hd0000000000.m4s',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    }),
    signReadUrl: async (storagePath) => {
      signedPaths.push(storagePath);
      return `https://signed.example/${encodeURIComponent(storagePath)}`;
    },
  });

  assert.equal(bundle.playlistCount, 2);
  assert.equal(bundle.segmentCount, 3);
  assert.match(bundle.masterManifest, /__ENTRETENIMENTO_HLS_PLAYLIST_0__/);
  assert.match(bundle.masterManifest, /__ENTRETENIMENTO_HLS_PLAYLIST_1__/);
  assert.equal(bundle.masterManifest.includes('users/owner-1'), false);
  assert.equal(bundle.playlists.length, 2);
  assert.equal(
    bundle.playlists.every((playlist) =>
      playlist.manifest.includes('https://signed.example/')
    ),
    true
  );
  assert.deepEqual(signedPaths.sort(), [
    'users/owner-1/processed/videos/video-1/run-1/media-sd0000000000.ts',
    'users/owner-1/processed/videos/video-1/run-1/video-hd0000000000.m4s',
    'users/owner-1/processed/videos/video-1/run-1/video-init.m4s',
  ].sort());
});

test('rejeita referências externas no manifest principal', async () => {
  await assert.rejects(
    buildPublicVideoHlsBundle({
      masterStoragePath: MASTER_PATH,
      expiresAt: Date.now() + 30 * 60_000,
      readTextFile: fixtureReader({
        [MASTER_PATH]: [
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=900000',
          'https://attacker.example/media.m3u8',
        ].join('\n'),
      }),
      signReadUrl: async () => 'https://signed.example/file',
    }),
    /referência externa ou inválida/
  );
});

test('rejeita traversal para fora do namespace processado', async () => {
  await assert.rejects(
    buildPublicVideoHlsBundle({
      masterStoragePath: MASTER_PATH,
      expiresAt: Date.now() + 30 * 60_000,
      readTextFile: fixtureReader({
        [MASTER_PATH]: [
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=900000',
          '../../../../../../outro/manifest.m3u8',
        ].join('\n'),
      }),
      signReadUrl: async () => 'https://signed.example/file',
    }),
    /sair do namespace processado/
  );
});

test('rejeita extensão de segmento não autorizada', async () => {
  await assert.rejects(
    buildPublicVideoHlsBundle({
      masterStoragePath: MASTER_PATH,
      expiresAt: Date.now() + 30 * 60_000,
      readTextFile: fixtureReader({
        [MASTER_PATH]: [
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=900000',
          'media-sd.m3u8',
        ].join('\n'),
        [SD_PATH]: [
          '#EXTM3U',
          '#EXTINF:6.0,',
          'payload.html',
          '#EXT-X-ENDLIST',
        ].join('\n'),
      }),
      signReadUrl: async () => 'https://signed.example/file',
    }),
    /Extensão HLS não autorizada/
  );
});
