import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VIDEO_VIEW_COUNT_INTERVAL_MS,
  VIDEO_VIEW_COUNT_WINDOW_MS,
  VIDEO_VIEW_MAX_COUNTS_PER_WINDOW,
  buildVideoViewCountDecision,
  calculateRequiredVideoPlaybackMs,
  normalizeVideoViewPlaybackEvidence,
} from './video-view-qualification';

const NOW = 1_800_000_000_000;

function validEvidence(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session_1234567890abcdef',
    playbackMs: 7_500,
    durationMs: 30_000,
    qualifiedAt: NOW - 1_000,
    ...overrides,
  };
}

describe('video-view-qualification', () => {
  it('calcula limiar proporcional com limites para vídeos curtos e longos', () => {
    assert.equal(calculateRequiredVideoPlaybackMs(2_000), 1_600);
    assert.equal(calculateRequiredVideoPlaybackMs(10_000), 3_000);
    assert.equal(calculateRequiredVideoPlaybackMs(30_000), 7_500);
    assert.equal(calculateRequiredVideoPlaybackMs(120_000), 10_000);
  });

  it('aceita somente evidência recente e compatível com a duração do servidor', () => {
    assert.deepEqual(
      normalizeVideoViewPlaybackEvidence({
        evidence: validEvidence(),
        serverDurationMs: 30_000,
        now: NOW,
      }),
      {
        sessionId: 'session_1234567890abcdef',
        playbackMs: 7_500,
        durationMs: 30_000,
        qualifiedAt: NOW - 1_000,
        requiredPlaybackMs: 7_500,
      }
    );

    assert.equal(
      normalizeVideoViewPlaybackEvidence({
        evidence: validEvidence({ playbackMs: 7_499 }),
        serverDurationMs: 30_000,
        now: NOW,
      }),
      null
    );
    assert.equal(
      normalizeVideoViewPlaybackEvidence({
        evidence: validEvidence({ sessionId: 'curta' }),
        serverDurationMs: 30_000,
        now: NOW,
      }),
      null
    );
    assert.equal(
      normalizeVideoViewPlaybackEvidence({
        evidence: validEvidence({ durationMs: 60_000 }),
        serverDurationMs: 30_000,
        now: NOW,
      }),
      null
    );
  });

  it('conta a primeira visualização qualificada', () => {
    assert.deepEqual(
      buildVideoViewCountDecision({
        now: NOW,
        isUniqueViewer: true,
        lastCountedAt: 0,
        countWindowStartedAt: 0,
        countWindowCount: 0,
        samePlaybackSession: false,
      }),
      {
        canCount: true,
        retryAfterMs: VIDEO_VIEW_COUNT_INTERVAL_MS,
        nextCountWindowStartedAt: NOW,
        nextCountWindowCount: 1,
      }
    );
  });

  it('bloqueia repetição da mesma sessão e respeita o intervalo mínimo', () => {
    const sameSession = buildVideoViewCountDecision({
      now: NOW,
      isUniqueViewer: false,
      lastCountedAt: NOW - VIDEO_VIEW_COUNT_INTERVAL_MS,
      countWindowStartedAt: NOW - 1_000,
      countWindowCount: 1,
      samePlaybackSession: true,
    });
    assert.equal(sameSession.canCount, false);

    const insideInterval = buildVideoViewCountDecision({
      now: NOW,
      isUniqueViewer: false,
      lastCountedAt: NOW - 5_000,
      countWindowStartedAt: NOW - 10_000,
      countWindowCount: 1,
      samePlaybackSession: false,
    });
    assert.equal(insideInterval.canCount, false);
    assert.equal(
      insideInterval.retryAfterMs,
      VIDEO_VIEW_COUNT_INTERVAL_MS - 5_000
    );
  });

  it('limita a contribuição diária e reinicia a janela expirada', () => {
    const capped = buildVideoViewCountDecision({
      now: NOW,
      isUniqueViewer: false,
      lastCountedAt: NOW - VIDEO_VIEW_COUNT_INTERVAL_MS,
      countWindowStartedAt: NOW - 5_000,
      countWindowCount: VIDEO_VIEW_MAX_COUNTS_PER_WINDOW,
      samePlaybackSession: false,
    });
    assert.equal(capped.canCount, false);

    const renewedWindow = buildVideoViewCountDecision({
      now: NOW,
      isUniqueViewer: false,
      lastCountedAt: NOW - VIDEO_VIEW_COUNT_INTERVAL_MS,
      countWindowStartedAt: NOW - VIDEO_VIEW_COUNT_WINDOW_MS,
      countWindowCount: VIDEO_VIEW_MAX_COUNTS_PER_WINDOW,
      samePlaybackSession: false,
    });
    assert.equal(renewedWindow.canCount, true);
    assert.equal(renewedWindow.nextCountWindowStartedAt, NOW);
    assert.equal(renewedWindow.nextCountWindowCount, 1);
  });
});
