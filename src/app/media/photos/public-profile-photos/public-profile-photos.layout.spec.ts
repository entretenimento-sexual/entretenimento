import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('galeria publica de perfil: composicao e navegacao', () => {
  const pageCss = source('src/app/media/photos/public-profile-photos/public-profile-photos.component.css');
  const pageHtml = source('src/app/media/photos/public-profile-photos/public-profile-photos.component.html');
  const cardCss = source('src/app/media/shared/components/public-photo-card/public-photo-card.component.css');
  const cardHtml = source('src/app/media/shared/components/public-photo-card/public-photo-card.component.html');
  const component = source('src/app/media/photos/public-profile-photos/public-profile-photos.component.ts');

  it('nao promove automaticamente a primeira foto para um card gigante', () => {
    expect(pageHtml).not.toContain('photo-grid-item--featured');
    expect(pageHtml).not.toContain('Destaque do perfil');
    expect(pageCss).not.toContain('grid-auto-flow: dense');
    expect(pageCss).not.toContain('grid-row: span 2');
    expect(pageCss).not.toContain('grid-column: span 2');
    expect(pageHtml).toContain('[class.photo-grid-item--cover]="item.isCover === true"');
  });

  it('distribui 1 a 4 colunas pela largura disponivel do conteiner', () => {
    expect(pageCss).toContain('container: public-photos-gallery / inline-size;');
    expect(pageCss).toContain('grid-template-columns: minmax(0, 1fr);');
    for (const width of [400, 760, 1080]) {
      expect(pageCss).toContain('(min-width: ' + width + 'px)');
    }
    expect(pageCss).toContain('repeat(4, minmax(0, 1fr))');
    expect(pageCss).toContain('box-sizing: border-box');
  });

  it('coloca metricas em rodape apenas na variante profile', () => {
    expect(cardCss).toContain('.photo-tile--profile .photo-overlay.app-media-overlay {');
    expect(cardCss).toContain('position: static;');
    expect(cardCss).toContain('min-height: 54px;');
    expect(cardCss).toContain('.photo-tile--profile .stat-chip');
    expect(cardHtml).toContain("@if (mode !== 'profile') {");
    expect(cardHtml).toContain("@if (mode !== 'feed') {");
    expect(cardHtml).toContain('class="photo-stats"');
    expect(cardHtml).toContain('@if (item.isCover) {');
  });

  it('mostra dono identificado e navegacao sem ler documentos privados', () => {
    expect(pageHtml).toContain('<app-page-header title="Fotos">');
    expect(pageHtml).not.toContain('Fotos públicas');
    expect(pageHtml).toContain('page-actions');
    expect(pageHtml).toContain('{{ identity.nickname }}');
    expect(pageHtml).toContain('{{ identityLabel }}');
    expect(pageHtml).toContain('class="visited-gallery-header__back"');
    expect(pageHtml).toContain('class="visually-hidden">Voltar ao perfil</span>');
    expect(pageCss).toContain('opacity: 0.75;');
    expect(pageHtml).not.toContain('<h1');
    expect(pageHtml).toContain('visited-gallery-header__avatar');
    expect(pageHtml).toContain("['/perfil', ownerUid]");
    expect(pageHtml).toContain("['/media/perfil', ownerUid, 'videos-publicos']");
    expect(pageCss).toContain('.visited-gallery-header__content');
    expect(pageCss).toContain('@container public-photos-gallery (max-width: 540px)');
    expect(component).toContain('getPublicUserById$(');
    expect(component).not.toContain('getUserById$(');
  });

  it('mantem paginacao, deduplicacao e abertura por identidade no viewer', () => {
    expect(component).toContain('this.photoPagination.loadPage$(');
    expect(component).toContain('this.mergePages(pages)');
    expect(component).toContain('selected.id !== expectedPhoto.id');
    expect(component).toContain('selected.ownerUid !== expectedPhoto.ownerUid');
    expect(component).toContain('this.photoViewerLauncher.open$({');
    expect(pageHtml).toContain('(click)="loadMorePhotos()"');
    expect(pageHtml).toContain('(preview)="openPhoto(i, item)"');
  });
});
