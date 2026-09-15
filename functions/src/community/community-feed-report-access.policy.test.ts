import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCommunityFeedReportAccess } from './community-feed-report-access.policy';

function buildCommunity(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: 'Comunidade teste',
    slug: 'comunidade-teste',
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderation: { state: 'active' },
    visibility: 'public_preview',
    access: { preview: 'authenticated' },
    ...overrides,
  };
}

describe('community-feed-report-access policy', () => {
  it('mantém denúncia disponível para visitante em preview autenticado ativo', () => {
    assert.deepEqual(
      evaluateCommunityFeedReportAccess(
        'community-1',
        buildCommunity(),
        null
      ),
      {
        allowed: true,
        memberContentAccess: false,
        authenticatedPreviewAccess: true,
        denialReason: null,
      }
    );
  });

  it('mantém acesso de membro em comunidade reservada', () => {
    const decision = evaluateCommunityFeedReportAccess(
      'community-1',
      buildCommunity({ visibility: 'members_only' }),
      { status: 'active', role: 'member' }
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.memberContentAccess, true);
    assert.equal(decision.authenticatedPreviewAccess, false);
  });

  it('preserva acesso legado de membro vinculado em comunidade arquivada', () => {
    const decision = evaluateCommunityFeedReportAccess(
      'community-1',
      buildCommunity({ status: 'archived', visibility: 'hidden' }),
      { status: 'active', role: 'member' }
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.memberContentAccess, true);
  });

  it('bloqueia nova denúncia após scheduled_for_deletion mesmo com membro ativo', () => {
    assert.deepEqual(
      evaluateCommunityFeedReportAccess(
        'community-1',
        buildCommunity({
          status: 'scheduled_for_deletion',
          visibility: 'hidden',
        }),
        { status: 'active', role: 'member' }
      ),
      {
        allowed: false,
        memberContentAccess: false,
        authenticatedPreviewAccess: false,
        denialReason: 'scheduled_for_deletion',
      }
    );
  });

  it('bloqueia scheduled_for_deletion mesmo com snapshot de preview antigo', () => {
    const decision = evaluateCommunityFeedReportAccess(
      'community-1',
      buildCommunity({ status: 'scheduled_for_deletion' }),
      null
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'scheduled_for_deletion');
  });

  it('membership bloqueada prevalece sobre preview público', () => {
    const decision = evaluateCommunityFeedReportAccess(
      'community-1',
      buildCommunity(),
      { status: 'blocked', role: 'member' }
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'access_denied');
  });
});
