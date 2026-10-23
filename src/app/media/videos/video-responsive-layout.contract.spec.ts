import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Prevent regressions when the profile mosaic is embedded in a narrow column,
 * or video playback is opened on a short landscape phone.
 */
function css(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8');
}

describe('Media video responsive layout contracts', () => {
  it('sizes visitor gallery columns and pagination from their container', () => {
    const styles = css('./public-profile-videos/public-profile-videos.component.css');
    expect(styles).toContain('container: public-videos-gallery / inline-size');
    expect(styles).toContain('@container public-videos-gallery (min-width: 560px)');
    expect(styles).toContain('padding: 12px clamp(12px, 3vw, 28px) 32px');
    expect(styles).not.toMatch(/@container public-videos-gallery[^}]*\.public-videos-page\s*\{/s);
    expect(styles).toContain('@container public-videos-gallery (min-width: 1080px)');
    expect(styles).toMatch(/\.gallery-pagination\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  });

  it('adapts mixed profile media to its sidebar and preserves full video posters', () => {
    const styles = css('../shared/components/profile-media-showcase/profile-media-showcase.component.css');
    const videoStyles = css('../shared/components/profile-media-showcase/profile-media-showcase-video.component.css');
    expect(styles).toContain('container: profile-media-mosaic / inline-size');
    expect(styles).toContain('@container profile-media-mosaic (max-width: 640px)');
    expect(styles).toContain('@container profile-media-mosaic (max-width: 340px)');
    expect(videoStyles).toContain('object-fit: contain');
    expect(videoStyles).toContain('[aria-disabled="true"]');
    expect(videoStyles).not.toContain('.profile-media-showcase__item:disabled');
  });

  it('compacts actions without clipping the share menu in a short landscape viewer', () => {
    const viewer = css('./public-video-viewer/public-video-viewer.component.css');
    const share = css('./public-video-share-actions/public-video-share-actions.component.css');
    expect(viewer).toContain('(max-height: 460px) and (orientation: landscape)');
    expect(viewer).toContain('grid-template-columns: repeat(3, minmax(48px, 1fr))');
    expect(viewer).toContain('max(12px, env(safe-area-inset-right))');
    expect(viewer).toContain('max(8px, env(safe-area-inset-left))');
    expect(viewer).toContain('max(9px, env(safe-area-inset-right))');
    expect(viewer).toContain('(max-width: 520px) and (max-height: 460px)');
    expect(viewer).toContain('grid-template-columns: repeat(2, minmax(48px, 1fr))');
    expect(share).toContain('.public-video-share-action small');
    expect(share).toContain('(max-height: 460px) and (orientation: landscape)');
  });

  it('provides explicit return routes from private and public video galleries', () => {
    const owner = css('./profile-videos/profile-videos.component.html');
    const visitor = css('./public-profile-videos/public-profile-videos.component.html');
    expect(owner).toContain('routerLink="/perfil"');
    expect(owner).toContain('aria-label="Voltar ao meu perfil"');
    expect(visitor).toContain('aria-label="Abrir o perfil que publicou estes vídeos"');
    expect(visitor).toContain('<div page-actions class="gallery-actions">');
    expect(visitor).not.toContain('Voltar ao perfil');
    expect(visitor).toContain("viewerUid === galleryProfileUid");
    expect(visitor).toContain("['/outro-perfil', galleryProfileUid]");
    expect(visitor).toContain("['/perfil']");
  });

  it('avoids empty action bars for visitors without sessions and announces the visible range', () => {
    const html = css('./public-profile-videos/public-profile-videos.component.html');
    const styles = css('./public-profile-videos/public-profile-videos.component.css');
    expect(html).toContain('@if (viewerUid) {');
    expect(html).toContain('[attr.aria-label]');
    expect(html).toContain('tabindex="-1"');
    expect(styles).toContain('.videos-grid:focus-visible');
    expect(styles).toContain('scroll-margin-block-start');
  });

  it('keeps owner-only previews scrollable inside the dynamic viewport', () => {
    const ownerViewer = css('./profile-videos/owner-private-video-viewer.component.ts');
    expect(ownerViewer).toContain('max-height: 100dvh');
    expect(ownerViewer).toContain('overflow-y: auto');
    expect(ownerViewer).toContain('calc(100dvh - 168px)');
  });
});
