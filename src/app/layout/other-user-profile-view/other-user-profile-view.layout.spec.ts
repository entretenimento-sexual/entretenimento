import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('perfil público visitado: composição editorial', () => {
  const css = source('src/app/layout/other-user-profile-view/other-user-profile-view.component.css');
  const html = source('src/app/layout/other-user-profile-view/other-user-profile-view.component.html');
  const mosaicCss = source('src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component.css');
  const mosaicHtml = source('src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component.html');

  it('prioriza a mídia em largura integral, sem reservar uma coluna lateral vazia', () => {
    expect(css).toContain('grid-template-areas:\n    "main"\n    "sidebar"');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('radial-gradient(ellipse at 82% 18%');
    expect(css).not.toContain('grid-template-areas: "sidebar main"');
    expect(html).toContain('class="other-profile-page__hero"');
    expect(html).toContain('class="other-profile-page__main"');
    expect(html).toContain('class="other-profile-page__sidebar"');
  });

  it('mantém o núcleo de identidade autorizado e as ações existentes', () => {
    expect(html).toContain('id="profile-heading"');
    expect(html).toContain('<app-public-user-identity');
    expect(html).toContain('[showName]="false"');
    expect(html).toContain('[showAvatar]="false"');
    expect(html).toContain('[ownerUid]="uid || \'\'"');
    expect(html).toContain('(click)="sendFriendRequest()"');
    expect(html).toContain('(click)="startDirectChat()"');
    expect(html).toContain('<app-report-content-button');
    expect(html).not.toContain('profile.idade');
  });

  it('usa estrutura social com bio opcional, âncoras e ações reais', () => {
    expect(html).toContain('class="other-profile-page__photo-wrap"');
    expect(css).toContain('aspect-ratio: 1;');
    expect(css).toContain('border-radius: 50%;');
    expect(html).toContain('class="other-profile-page__intro"');
    expect(html).toContain('{{ profile.descricao }}');
    expect(html).toContain('class="other-profile-page__sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("['/media', 'perfil', uid, 'fotos-publicas']");
    expect(html).toContain("['/media', 'perfil', uid, 'videos-publicos']");
    expect(html).toContain('href="#profile-details"');
    expect(html).toContain('id="profile-media"');
    expect(html).toContain('id="profile-details"');
    expect(css).toContain('min-height: var(--tap-target, 44px)');
    expect(css).toContain('.other-profile-page__section-link--active::after');
    expect(html).not.toContain('Seguidores');
    expect(html).not.toContain('Curtidas recebidas');
    expect(html).not.toContain('Verificado');
  });

  it('aplica mosaico somente quando há cinco mídias, sem alterar seleção ou rota', () => {
    expect(mosaicHtml).toContain(
      '[class.profile-media-showcase__grid--mosaic]="visibleItems(state.items).length >= 5"'
    );
    expect(mosaicHtml).toContain('(click)="openMedia(item, index)"');
    expect(mosaicHtml).toContain('[routerLink]="photoGalleryLink()"');
    expect(mosaicCss).toContain('.profile-media-showcase__grid--mosaic');
    expect(mosaicCss).toContain('grid-column: span 2;');
    expect(mosaicCss).toContain('@container profile-media-mosaic (max-width: 900px)');
    expect(mosaicCss).toContain('min-height: var(--tap-target, 44px)');
  });
});
