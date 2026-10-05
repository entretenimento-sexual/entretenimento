import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPossibleMinorContentSafetyAssessment,
  buildReviewedMinorContentSafetyAssessment,
  buildUnassessedMediaContentSafetyAssessment,
} from './media-content-safety-assessment.policy';

describe('media-content-safety-assessment.policy', () => {
  it('publicação imediata nasce UNASSESSED sem bloquear distribuição por si só', () => {
    assert.deepEqual(
      buildUnassessedMediaContentSafetyAssessment(1_800_000_000_000),
      {
        schemaVersion: 1,
        state: 'UNASSESSED',
        source: 'PUBLICATION',
        reason: null,
        confidence: null,
        assessedAtMs: 1_800_000_000_000,
        assessorId: null,
      }
    );
  });

  it('denúncia crítica gera POSSIBLE_MINOR independente do assurance do owner', () => {
    assert.deepEqual(
      buildPossibleMinorContentSafetyAssessment({
        reason: 'minor_exposure_safety',
        assessedAtMs: 1_800_000_000_000,
        assessorId: 'reporter-1',
      }),
      {
        schemaVersion: 1,
        state: 'POSSIBLE_MINOR',
        source: 'HUMAN_REPORT',
        reason: 'minor_exposure_safety',
        confidence: null,
        assessedAtMs: 1_800_000_000_000,
        assessorId: 'reporter-1',
      }
    );
  });

  it('sinal automático futuro usa a mesma autoridade sem virar pré-aprovação', () => {
    assert.deepEqual(
      buildPossibleMinorContentSafetyAssessment({
        reason: 'minor_content_safety',
        source: 'AUTOMATED_SIGNAL',
        confidence: 1.4,
        assessedAtMs: 1_800_000_000_000,
      }),
      {
        schemaVersion: 1,
        state: 'POSSIBLE_MINOR',
        source: 'AUTOMATED_SIGNAL',
        reason: 'minor_content_safety',
        confidence: 1,
        assessedAtMs: 1_800_000_000_000,
        assessorId: null,
      }
    );
  });

  it('revisão humana confirma ou limpa a suspeita', () => {
    assert.deepEqual(
      buildReviewedMinorContentSafetyAssessment({
        confirmed: true,
        reason: 'minor_content_safety',
        moderatorUid: 'admin-1',
        assessedAtMs: 1_800_000_000_000,
      }),
      {
        schemaVersion: 1,
        state: 'CONFIRMED_MINOR',
        source: 'MODERATOR_REVIEW',
        reason: 'minor_content_safety',
        confidence: 1,
        assessedAtMs: 1_800_000_000_000,
        assessorId: 'admin-1',
      }
    );

    assert.deepEqual(
      buildReviewedMinorContentSafetyAssessment({
        confirmed: false,
        reason: 'minor_content_safety',
        moderatorUid: 'admin-1',
        assessedAtMs: 1_800_000_000_000,
      }),
      {
        schemaVersion: 1,
        state: 'CLEARED',
        source: 'MODERATOR_REVIEW',
        reason: null,
        confidence: null,
        assessedAtMs: 1_800_000_000_000,
        assessorId: 'admin-1',
      }
    );
  });
});
