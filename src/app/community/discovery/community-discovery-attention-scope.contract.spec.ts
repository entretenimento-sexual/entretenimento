// src/app/community/discovery/community-discovery-attention-scope.contract.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  resolve(
    process.cwd(),
    'src/app/community/discovery/community-discovery-page.component.html'
  ),
  'utf8'
);

describe('Community discovery loaded attention scope contract', () => {
  it('mantém a ordenação de Minhas explicitamente limitada ao conteúdo carregado', () => {
    expect(template).toContain('id="community-mine-attention-scope"');
    expect(template).toContain(
      'As Comunidades carregadas são organizadas por atenção; ao ver mais, novas atividades podem aparecer acima.'
    );
    expect(template).toContain(
      "[attr.aria-describedby]=\"discoveryMode === 'mine' ? 'community-mine-attention-scope' : null\""
    );
    expect(template).toContain('[attr.aria-busy]="state.loadingMore"');
    expect(template).toContain('aria-label="Ver mais comunidades"');
  });
});
