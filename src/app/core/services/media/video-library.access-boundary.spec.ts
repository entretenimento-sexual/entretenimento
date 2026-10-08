import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/core/services/media/video-library.service.ts'),
  'utf8'
);

function bodyBetween(begin: string, end: string): string {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) {
    throw new Error('Método obrigatório ausente no VideoLibraryService.');
  }
  return source.slice(start, finish);
}

describe('VideoLibraryService / playback explícito e custo controlado', () => {
  it('watchPrivateVideos$ observa metadados e capas, sem renovação automática de playback', () => {
    const watcher = bodyBetween(
      'watchPrivateVideos$(ownerUid: string)',
      'hydrateOwnedVideoAccess$('
    );
    expect(watcher).toContain('watchOwnedVideoMetadata$(');
    expect(watcher).toContain('hydrateOwnedVideoPreviewAccess$(');
    expect(watcher).toContain('timer(0, VIDEO_OWNER_ACCESS_REFRESH_MS)');
    expect(watcher).not.toContain("mode: 'PLAYBACK'");
  });

  it('playback privado permanece restrito à chamada explícita', () => {
    const method = bodyBetween(
      'hydrateOwnedVideoAccess$(',
      'hydrateOwnedVideoPreviewAccess$('
    );
    expect(method).toContain('hydratePrivateUrls$(');
    expect(source).toContain("mode: 'PLAYBACK'");
    expect(source).toContain("mode: 'PREVIEW'");
  });

  it('URLs privadas não sobrevivem a troca de sessão em respostas atrasadas', () => {
    expect(source).toContain('this.previewCache.clear()');
    expect(source).toContain('this.previewInFlight.clear()');
    expect(source).toContain('this.requestPrivateVideoPreviews$(');
    expect(source).toContain('sessionScope !== this.currentSessionScope()');
    expect(source).toContain('return defer(() => {');
  });
});
