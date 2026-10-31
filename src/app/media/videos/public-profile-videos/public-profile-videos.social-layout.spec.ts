import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('galeria pública de vídeos: navegação social', () => {
  const html = source('src/app/media/videos/public-profile-videos/public-profile-videos.component.html');
  const css = source('src/app/media/videos/public-profile-videos/public-profile-videos.component.css');
  const photosHtml = source('src/app/media/photos/public-profile-photos/public-profile-photos.component.html');

  it('oferece as mesmas seções de perfil, fotos e vídeos da galeria fotográfica', () => {
    expect(html).toContain('class="public-videos-page__tabs"');
    expect(html).toContain('aria-label="Seções do perfil visitado"');
    expect(html).toContain("['/media', 'perfil', galleryProfileUid, 'fotos-publicas']");
    expect(html).toContain('profileReturnRoute(galleryProfileUid, viewerUid)');
    expect(html).toContain('class="public-videos-page__back"');
    expect(html).toContain('class="public-videos-page__tab public-videos-page__tab--active" aria-current="page"');
    expect(photosHtml).toContain('class="visited-gallery-header__tabs"');
    expect(photosHtml).toContain('aria-current="page"');
  });

  it('mantém retorno junto ao título e identidade editorial na densidade da galeria de fotos', () => {
    expect(html).toContain('class="public-videos-page__heading"');
    expect(html).toContain('<app-page-header title="Vídeos">');
    expect(html).toContain('class="public-videos-page__back"');
    expect(css).toContain('.public-videos-page__heading app-page-header');
    expect(css).toContain('--public-user-identity-avatar-size: clamp(44px, 4vw, 54px)');
    expect(css).not.toContain('padding: 2.85rem');
    expect(css).toContain('container: public-videos-gallery / inline-size');
    expect(photosHtml).toContain('class="visited-gallery-heading"');
    expect(photosHtml).toContain('class="public-photos-page__count"');
  });

  it('mantém título, identidade, ações de segurança e retorno do viewer', () => {
    expect(html).toContain('<app-page-header title="Vídeos">');
    expect(html).toContain('<app-public-user-identity');
    expect(html).toContain('<app-report-content-button');
    expect(html).toContain('(preview)="openVideo(state.items.indexOf(item), item)"');
    expect(html).toContain('public-videos-page__gallery-return');
    expect(css).toContain('min-height: var(--tap-target, 44px)');
    expect(css).toContain('.public-videos-page__tab--active::after');
    expect(css).toContain('@container public-videos-gallery (max-width: 540px)');
    expect(html).not.toContain('Seguidores');
  });
});
