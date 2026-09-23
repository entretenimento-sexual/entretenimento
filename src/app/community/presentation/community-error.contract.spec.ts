import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_ERROR_PRESENTATION_CONTEXTS,
  COMMUNITY_PUBLIC_REASON_MESSAGES,
  COMMUNITY_PUBLIC_REASON_PRESENTATIONS,
  resolveCommunityPublicErrorPresentation,
} from './community-error.catalog';
import { COMMUNITY_PUBLIC_ERROR_REASONS } from './community-error-reason.contract';

describe('community public error reason contract', () => {
  it('mantém cobertura completa reason -> mensagem -> presentation', () => {
    expect(new Set(COMMUNITY_PUBLIC_ERROR_REASONS).size)
      .toBe(COMMUNITY_PUBLIC_ERROR_REASONS.length);
    expect(Object.keys(COMMUNITY_PUBLIC_REASON_MESSAGES).sort())
      .toEqual([...COMMUNITY_PUBLIC_ERROR_REASONS].sort());
    expect(Object.keys(COMMUNITY_PUBLIC_REASON_PRESENTATIONS).sort())
      .toEqual([...COMMUNITY_PUBLIC_ERROR_REASONS].sort());
    for (const reason of COMMUNITY_PUBLIC_ERROR_REASONS) {
      expect(COMMUNITY_PUBLIC_REASON_MESSAGES[reason].trim().length)
        .toBeGreaterThan(0);
      expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS[reason]).toBeTruthy();
    }
  });

  it('modaliza bloqueios e mantém falhas triviais leves', () => {
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.owner_transfer_required.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.membership_status_invalid.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.ownership_inconsistent.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_capacity_upgrade_required.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_ownership_capacity_upgrade_required.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_ownership_subscription_required.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_ownership_limit_reached.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.official_target_already_associated.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.official_creation_target_authority_mismatch.surface).toBe('modal');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.official_community_creation_rate_limited.surface).toBe('snackbar');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_feed_rate_limited.surface).toBe('snackbar');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.invalid_post_request.surface).toBe('snackbar');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_feed_post_not_found.surface).toBe('snackbar');
    expect(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.invite_expired.surface).toBe('snackbar');
  });

  it('silencia apenas erros não bloqueantes no contexto inline', () => {
    expect(
      resolveCommunityPublicErrorPresentation(
        'invalid_post_request',
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.SILENT_NON_BLOCKING
      )
    ).toEqual({ surface: 'none', severity: 'error' });

    expect(
      resolveCommunityPublicErrorPresentation(
        'ownership_inconsistent',
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.SILENT_NON_BLOCKING
      )?.surface
    ).toBe('modal');
  });

  it('expõe apenas contextos semânticos reutilizáveis', () => {
    expect(
      resolveCommunityPublicErrorPresentation(
        'invalid_post_request',
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.INLINE_NON_BLOCKING
      )
    ).toEqual({ surface: 'inline', severity: 'error' });

    expect(
      resolveCommunityPublicErrorPresentation(
        'invalid_post_request',
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.WARNING_NON_BLOCKING
      )
    ).toEqual({ surface: 'snackbar', severity: 'warning' });

    expect(
      resolveCommunityPublicErrorPresentation(
        'ownership_inconsistent',
        COMMUNITY_ERROR_PRESENTATION_CONTEXTS.INLINE_NON_BLOCKING
      )?.surface
    ).toBe('modal');
  });

  it('mantém o catálogo default como fonte canônica', () => {
    expect(
      resolveCommunityPublicErrorPresentation('community_feed_rate_limited')
    ).toBe(
      COMMUNITY_PUBLIC_REASON_PRESENTATIONS.community_feed_rate_limited
    );
    expect(
      resolveCommunityPublicErrorPresentation('invalid_post_request')
    ).toBe(COMMUNITY_PUBLIC_REASON_PRESENTATIONS.invalid_post_request);
  });

});
