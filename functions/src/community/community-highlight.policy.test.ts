import { describe, expect, it } from 'vitest';

import { evaluateCommunityHighlightAction } from './community-highlight.policy';

describe('community-highlight.policy', () => {
  for (const viewerRole of ['owner', 'admin', 'moderator'] as const) {
    it(`permite ${viewerRole} ativo fixar publicação ativa`, () => {
      expect(evaluateCommunityHighlightAction({
        action: 'pin',
        sourceType: 'community',
        membershipStatus: 'active',
        viewerRole,
        targetPostStatus: 'active',
        targetPostModerationState: 'active',
      })).toEqual({ allowed: true, denialReason: null });
    });
  }

  it('impede membro comum de administrar destaque', () => {
    expect(evaluateCommunityHighlightAction({
      action: 'pin',
      sourceType: 'community',
      membershipStatus: 'active',
      viewerRole: 'member',
      targetPostStatus: 'active',
      targetPostModerationState: 'active',
    })).toEqual({
      allowed: false,
      denialReason: 'active_management_required',
    });
  });

  it('exige vínculo ativo mesmo para papel administrativo', () => {
    expect(evaluateCommunityHighlightAction({
      action: 'unpin',
      sourceType: 'community',
      membershipStatus: 'left',
      viewerRole: 'admin',
    })).toEqual({
      allowed: false,
      denialReason: 'active_management_required',
    });
  });

  it('não aplica destaque editorial a outro tipo de espaço', () => {
    expect(evaluateCommunityHighlightAction({
      action: 'unpin',
      sourceType: 'venue',
      membershipStatus: 'active',
      viewerRole: 'owner',
    })).toEqual({
      allowed: false,
      denialReason: 'community_source_not_supported',
    });
  });

  it('não permite fixar publicação removida ou indisponível', () => {
    expect(evaluateCommunityHighlightAction({
      action: 'pin',
      sourceType: 'community',
      membershipStatus: 'active',
      viewerRole: 'moderator',
      targetPostStatus: 'removed',
      targetPostModerationState: 'removed',
    })).toEqual({
      allowed: false,
      denialReason: 'post_unavailable',
    });
  });

  it('desafixar não depende do estado do alvo antigo', () => {
    expect(evaluateCommunityHighlightAction({
      action: 'unpin',
      sourceType: 'community',
      membershipStatus: 'active',
      viewerRole: 'moderator',
      targetPostStatus: 'removed',
      targetPostModerationState: 'removed',
    })).toEqual({ allowed: true, denialReason: null });
  });
});
