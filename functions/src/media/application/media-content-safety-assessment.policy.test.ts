import { describe, expect, it } from 'vitest';

import {
  buildPossibleMinorContentSafetyAssessment,
  buildReviewedMinorContentSafetyAssessment,
  buildUnassessedMediaContentSafetyAssessment,
} from './media-content-safety-assessment.policy';

describe('media-content-safety-assessment.policy', () => {
  it('publicação imediata nasce UNASSESSED sem bloquear distribuição por si só', () => {
    expect(buildUnassessedMediaContentSafetyAssessment(1_800_000_000_000))
      .toEqual({
        schemaVersion: 1,
        state: 'UNASSESSED',
        source: 'PUBLICATION',
        reason: null,
        confidence: null,
        assessedAtMs: 1_800_000_000_000,
        assessorId: null,
      });
  });

  it('denúncia crítica gera POSSIBLE_MINOR independente do assurance do owner', () => {
    expect(buildPossibleMinorContentSafetyAssessment({
      reason: 'minor_exposure_safety',
      assessedAtMs: 1_800_000_000_000,
      assessorId: 'reporter-1',
    })).toMatchObject({
      state: 'POSSIBLE_MINOR',
      source: 'HUMAN_REPORT',
      reason: 'minor_exposure_safety',
      assessorId: 'reporter-1',
    });
  });

  it('sinal automático futuro usa a mesma autoridade sem virar pré-aprovação', () => {
    expect(buildPossibleMinorContentSafetyAssessment({
      reason: 'minor_content_safety',
      source: 'AUTOMATED_SIGNAL',
      confidence: 1.4,
      assessedAtMs: 1_800_000_000_000,
    })).toMatchObject({
      state: 'POSSIBLE_MINOR',
      source: 'AUTOMATED_SIGNAL',
      confidence: 1,
    });
  });

  it('revisão humana confirma ou limpa a suspeita', () => {
    expect(buildReviewedMinorContentSafetyAssessment({
      confirmed: true,
      reason: 'minor_content_safety',
      moderatorUid: 'admin-1',
      assessedAtMs: 1_800_000_000_000,
    })).toMatchObject({
      state: 'CONFIRMED_MINOR',
      source: 'MODERATOR_REVIEW',
      reason: 'minor_content_safety',
      confidence: 1,
      assessorId: 'admin-1',
    });

    expect(buildReviewedMinorContentSafetyAssessment({
      confirmed: false,
      reason: 'minor_content_safety',
      moderatorUid: 'admin-1',
      assessedAtMs: 1_800_000_000_000,
    })).toMatchObject({
      state: 'CLEARED',
      reason: null,
      confidence: null,
    });
  });
});
