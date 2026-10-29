import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('viewer de vídeo FRIENDS - interações indisponíveis sem autorização própria', () => {
  const template = source(
    'src/app/media/videos/public-video-viewer/public-video-viewer.component.html'
  );
  const component = source(
    'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts'
  );

  it('não oferece curtida, comentários, avaliações ou share externo para FRIENDS', () => {
    for (const condition of [
      "video.visibility === 'PUBLIC' && video.reactionsEnabled",
      "video.visibility === 'PUBLIC' && video.commentsEnabled",
      "video.visibility === 'PUBLIC' && video.ratingsEnabled",
      "viewerUid && video.visibility === 'PUBLIC'",
    ]) {
      expect(template).toContain(condition);
    }
  });

  it('evita listeners sociais PUBLIC e painéis em vídeo FRIENDS', () => {
    expect(component).toContain("if (!video || video.visibility !== 'PUBLIC')");
    expect(component).toContain("video?.visibility === 'PUBLIC'");
    expect(component).toContain(
      "this.current?.visibility !== 'PUBLIC' || this.current?.commentsEnabled !== true"
    );
    expect(component).toContain(
      "this.current?.visibility !== 'PUBLIC' || this.current?.ratingsEnabled !== true"
    );
  });
});
