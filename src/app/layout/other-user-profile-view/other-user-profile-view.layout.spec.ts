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

  it('distingue erro transitório de perfil inexistente com retry acessível', () => {
    expect(html).toContain('@else if (profileLoadError)');
    expect(html).toContain('title="Não foi possível carregar o perfil"');
    expect(html).toContain('state="error"');
    expect(html).toContain('(action)="retryProfile()"');
    expect(html).toContain('state="empty"');
    expect(html).toContain('title="Perfil indisponível"');
  });

  it('prioriza a mídia em largura integral, sem reservar uma coluna lateral vazia', () => {
    // Verifica a composição independentemente de LF/CRLF no checkout Windows.
    expect(css).toMatch(/grid-template-areas:\s*"main"\s*"sidebar"\s*;/u);
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
    expect(html).toContain('class="other-profile-page__introduction app-card app-card--flat"');
    expect(html.indexOf('id="profile-details"')).toBeLessThan(html.indexOf('id="profile-media"'));
    expect(html).toContain('class="other-profile-page__bio-text"');
    expect(html).toContain('Este perfil ainda não compartilhou uma apresentação pública.');
    expect(html).toContain('@for (group of publishedPreferenceGroups; track group.title)');
    expect(html).toContain('Redes sociais publicadas');
    expect(html.indexOf('aria-label="Redes sociais publicadas"'))
      .toBeLessThan(html.indexOf('id="profile-media"'));
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

  it('separa identidade e ações na hero e adapta a largura útil do shell', () => {
    const hero = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    expect(hero).toMatch(/<\/div>\s*@if \(friendshipInteractionState\$ \| async; as interactionState\) \{\s*<div class="other-profile-page__actions"/u);
    expect(css).toContain('container: visited-profile / inline-size;');
    expect(css).toContain('grid-column: 3;');
    expect(css).toContain('@container visited-profile (max-width: 740px)');
    expect(css).toContain('@container visited-profile (max-width: 480px)');
    expect(css).toContain('align-items: flex-end;');
    expect(css).toContain('grid-column: 2;');
    expect(css).toContain('grid-column: 1 / -1;');
    expect(css).toContain('min-height: var(--tap-target, 44px)');
  });

  it('compacta preferências autorizadas sem ocultá-las ou alterar a ordem', () => {
    expect(html).toContain('@if (publishedPreferenceGroups.length > 0)');
    expect(html).toContain('class="other-profile-page__affinities-grid"');
    expect(html).toContain('@for (group of publishedPreferenceGroups; track group.title)');
    expect(html).toContain('@for (label of group.labels; track label)');
    expect(css).toContain('repeat(auto-fit, minmax(min(100%, 23rem), 1fr))');
    expect(html.indexOf('class="other-profile-page__affinities-grid"'))
      .toBeLessThan(html.indexOf('id="profile-media"'));
  });

  it('alinha o cabeçalho Mídias às seções e adapta abas pela largura do perfil', () => {
    expect(mosaicCss).toContain('.profile-media-showcase__header {');
    expect(mosaicCss).toMatch(
      /\.profile-media-showcase__header\s*\{[^}]*justify-content:\s*flex-start;[^}]*text-align:\s*start;/u
    );
    expect(mosaicCss).toMatch(
      /\.profile-media-showcase__header h2\s*\{[^}]*margin:\s*0;/u
    );
    expect(css).toContain('@container visited-profile (max-width: 560px)');
    expect(css).toMatch(
      /@container visited-profile \(max-width: 560px\)[\s\S]*?\.other-profile-page__sections\s*\{[^}]*overflow-x:\s*auto;/u
    );
    expect(css).toContain('overscroll-behavior-inline: contain;');
    expect(css).toContain('scrollbar-width: thin;');
    expect(html).toContain('aria-label="Seções do perfil visitado"');
  });

  it('torna a hero social compacta e integra Sobre sem duplicar o nome', () => {
    expect(css).toMatch(/\.other-profile-page__hero\s*\{[^}]*padding:\s*clamp\(2\.85rem/u);
    expect(css).toMatch(/\.other-profile-page__hero::before\s*\{[^}]*height:\s*clamp\(3rem/u);
    expect(css).toMatch(/\.other-profile-page__introduction\s*\{[^}]*background:\s*transparent;/u);
    expect(html).toContain('<h2 id="profile-about-heading">Sobre</h2>');
    expect(html).not.toContain('Sobre {{ displayName }}');
  });

  it('densifica a vitrine sem alterar toque, foco e matriz de mídia pública', () => {
    expect(mosaicCss).toMatch(/\.profile-media-showcase__grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/u);
    expect(mosaicCss).toMatch(/\.profile-media-showcase__item\s*\{[^}]*aspect-ratio:\s*1\.14;/u);
    expect(mosaicCss).toContain('min-height: var(--tap-target, 44px)');
    expect(css).toContain('@container visited-profile (max-width: 420px)');
    expect(css).not.toContain('@media (max-width: 820px)');
  });

  it('aplica mosaico somente quando há cinco mídias, sem alterar seleção ou rota', () => {
    expect(mosaicHtml).toContain(
      '[class.profile-media-showcase__grid--mosaic]="visibleItems(state.items).length >= 5"'
    );
    expect(mosaicHtml).toContain('(click)="openMedia(item, index)"');
    expect(mosaicHtml).not.toContain('profile-media-showcase__links');
    expect(mosaicHtml).toContain('<h2 class="app-section-title">Mídias</h2>');
    expect(mosaicCss).toContain('.profile-media-showcase__grid--mosaic');
    expect(mosaicCss).toContain('grid-column: span 2;');
    expect(mosaicCss).toContain('@container profile-media-mosaic (max-width: 900px)');
    expect(mosaicCss).toContain('min-height: var(--tap-target, 44px)');
  });
});
