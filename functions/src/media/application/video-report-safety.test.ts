import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldPreserveMediaEvidence } from './media-report-safety';
import {
  buildVideoReportSafetyState,
  shouldQuarantineVideoAfterReport,
} from './video-report-safety';

describe('video-report-safety', () => {
  it('abre denúncia e reduz segurança sem confirmar infração', () => {
    assert.deepEqual(
      buildVideoReportSafetyState({}, 'OPEN'),
      {
        reportsCount: 1,
        openReportsCount: 1,
        confirmedReportsCount: 0,
        safetyScore: 92,
      }
    );
  });

  it('restaura segurança ao manter conteúdo denunciado', () => {
    assert.deepEqual(
      buildVideoReportSafetyState({
        reportsCount: 2,
        openReportsCount: 1,
        confirmedReportsCount: 0,
      }, 'KEEP'),
      {
        reportsCount: 2,
        openReportsCount: 0,
        confirmedReportsCount: 0,
        safetyScore: 100,
      }
    );
  });

  it('confirma incidente quando conteúdo é removido', () => {
    assert.deepEqual(
      buildVideoReportSafetyState({
        reportsCount: 3,
        openReportsCount: 2,
        confirmedReportsCount: 1,
      }, 'REMOVE'),
      {
        reportsCount: 3,
        openReportsCount: 1,
        confirmedReportsCount: 2,
        safetyScore: 42,
      }
    );
  });

  it('quarentena risco grave na primeira denúncia', () => {
    assert.equal(
      shouldQuarantineVideoAfterReport('minor_safety', 1),
      true
    );
    assert.equal(
      shouldQuarantineVideoAfterReport('illegal_content', 1),
      true
    );
    assert.equal(
      shouldQuarantineVideoAfterReport('sexual_boundary', 1),
      true
    );
  });

  it('não retira denúncia geral isolada da distribuição', () => {
    assert.equal(shouldQuarantineVideoAfterReport('spam', 1), false);
    assert.equal(shouldQuarantineVideoAfterReport('harassment', 2), false);
  });

  it('quarentena conteúdo com três denúncias gerais ainda abertas', () => {
    assert.equal(shouldQuarantineVideoAfterReport('spam', 3), true);
    assert.equal(shouldQuarantineVideoAfterReport('privacy', 4), true);
  });

  it('preserva evidência somente para categorias de risco grave', () => {
    assert.equal(shouldPreserveMediaEvidence('minor_safety'), true);
    assert.equal(shouldPreserveMediaEvidence('illegal_content'), true);
    assert.equal(shouldPreserveMediaEvidence('sexual_boundary'), true);
    assert.equal(shouldPreserveMediaEvidence('spam'), false);
    assert.equal(shouldPreserveMediaEvidence('harassment'), false);
  });
});
