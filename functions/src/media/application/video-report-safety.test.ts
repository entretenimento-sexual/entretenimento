import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildVideoReportSafetyState } from './video-report-safety';

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
});
