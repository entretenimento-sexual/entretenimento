import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMediaReportSafetyState,
  isAdultConsensualSexualContentViolation,
  isCriticalMinorMediaSafetyReason,
  mediaSafetySeverity,
  normalizeMinorMediaSafetyReason,
  shouldPreserveMediaEvidence,
  shouldQuarantineMediaAfterReport,
} from './media-report-safety';

describe('media-report-safety', () => {
  it('normaliza somente motivos de proteção de menores próprios de Media', () => {
    assert.equal(
      normalizeMinorMediaSafetyReason('minor_exposure_safety'),
      'minor_exposure_safety'
    );
    assert.equal(
      normalizeMinorMediaSafetyReason('minor_content_safety'),
      'minor_content_safety'
    );
    assert.equal(normalizeMinorMediaSafetyReason('minor_safety'), null);
    assert.equal(normalizeMinorMediaSafetyReason('nudity'), null);
  });

  it('trata exposição de criança/adolescente em mídia adulta como crítica', () => {
    assert.equal(isCriticalMinorMediaSafetyReason('minor_exposure_safety'), true);
    assert.equal(
      shouldQuarantineMediaAfterReport('minor_exposure_safety', 1),
      true
    );
    assert.equal(shouldPreserveMediaEvidence('minor_exposure_safety'), true);
  });

  it('trata possível conteúdo sexual ou íntimo envolvendo menor como crítico', () => {
    assert.equal(isCriticalMinorMediaSafetyReason('minor_content_safety'), true);
    assert.equal(
      shouldQuarantineMediaAfterReport('minor_content_safety', 1),
      true
    );
    assert.equal(shouldPreserveMediaEvidence('minor_content_safety'), true);
  });

  it('classifica menoridade como severidade máxima e não confunde sexo adulto consensual', () => {
    assert.equal(mediaSafetySeverity('minor_exposure_safety'), 'MAXIMUM_MINOR');
    assert.equal(mediaSafetySeverity('minor_content_safety'), 'MAXIMUM_MINOR');
    assert.equal(
      mediaSafetySeverity('non_consensual_sexual_content'),
      'HIGH'
    );
    assert.equal(mediaSafetySeverity('sexual_boundary'), 'STANDARD');
    assert.equal(isAdultConsensualSexualContentViolation(), false);
  });

  it('quarentena imediata usa motivo explícito de não consentimento, não nudez adulta genérica', () => {
    assert.equal(
      shouldQuarantineMediaAfterReport('non_consensual_sexual_content', 1),
      true
    );
    assert.equal(
      shouldQuarantineMediaAfterReport('sexual_boundary', 1),
      false
    );
  });

  it('não transforma conteúdo adulto comum em risco por ausência de sinal de menor', () => {
    assert.equal(shouldQuarantineMediaAfterReport('privacy', 1), false);
    assert.equal(shouldQuarantineMediaAfterReport('spam', 2), false);
  });

  it('mantém limiar antifraude para denúncias gerais', () => {
    assert.equal(shouldQuarantineMediaAfterReport('privacy', 3), true);
  });

  it('mantém contadores de segurança independentes da autoridade etária do perfil', () => {
    assert.deepEqual(buildMediaReportSafetyState({}, 'OPEN'), {
      reportsCount: 1,
      openReportsCount: 1,
      confirmedReportsCount: 0,
      safetyScore: 92,
    });
  });
});
