import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string =>
  readFileSync(resolve(process.cwd(), 'src/app/media/photos/photo-viewer', file), 'utf8');

describe('Photo viewer: composição e responsividade', () => {
  const css = source('photo-viewer.component.css');
  const html = source('photo-viewer.component.html');

  it('contém a imagem na altura do painel, sem estourar viewport ou distorcer', () => {
    expect(css).toMatch(/\.viewer-shell\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.viewer-media-frame\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*100%;/s);
    expect(css).toMatch(/\.viewer-img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*max-width:\s*100%;[^}]*max-height:\s*100%;[^}]*object-fit:\s*contain;/s);
    expect(css).not.toContain('max-height: calc(100dvh - 68px)');
    expect(html).toContain('class="viewer-img"');
  });

  it('mantém comentários, editor e reações agrupados no painel lateral', () => {
    expect(css).toMatch(/\.viewer-social-panel\s*\{[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(/\.comments-empty,\s*\.comments-disabled\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(/\.comments-list\s*\{[^}]*overflow:\s*auto;/s);
    expect(css).toContain('.reaction-bar {');
    expect(html.indexOf('class="comments-section"')).toBeLessThan(
      html.indexOf('class="reaction-bar"')
    );
    expect(html).toContain('class="comment-form"');
    expect(html).toContain('aria-label="Interações da foto"');
  });

  it('adapta visualizador compacto para tablet, celular e landscape baixo', () => {
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('grid-template-rows: minmax(260px, 62dvh) auto');
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('grid-template-rows: minmax(220px, 54dvh) auto');
    expect(css).toContain('(orientation: landscape) and (min-width: 700px)');
    expect(css).toContain('min-height: 44px;');
  });

  it('mantém identidade e botões acessíveis sem selo redundante do perfil', () => {
    expect(html).toContain('<app-public-user-identity');
    expect(html).toContain("@if (data.source !== 'profile')");
    expect(html).toContain('aria-label="Fechar visualizador"');
    expect(html).toContain('aria-label="Foto anterior"');
    expect(html).toContain("'Próxima foto'");
    expect(html).toContain('aria-label="Comentários da foto"');
    expect(html).toContain('aria-keyshortcuts="Escape"');
  });
});
