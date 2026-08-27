import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECENT_PUBLIC_MEDIA_VIEW_WINDOW_MS,
  isRecentPublicMediaView,
} from './recent-public-media-view.policy';

const NOW = 1_700_000_000_000;

test('considera recente visualização dentro da janela fixa', () => {
  assert.equal(isRecentPublicMediaView({
    lastViewedAt: NOW - RECENT_PUBLIC_MEDIA_VIEW_WINDOW_MS + 1,
    now: NOW,
  }), true);
});

test('considera antiga visualização fora da janela', () => {
  assert.equal(isRecentPublicMediaView({
    lastViewedAt: NOW - RECENT_PUBLIC_MEDIA_VIEW_WINDOW_MS - 1,
    now: NOW,
  }), false);
});

test('aceita Timestamp-like sem expor timestamp no contrato público', () => {
  assert.equal(isRecentPublicMediaView({
    lastViewedAt: {
      toMillis: () => NOW - 60_000,
    },
    now: NOW,
  }), true);
});

test('falha fechado para timestamp futuro ou ausente', () => {
  assert.equal(isRecentPublicMediaView({
    lastViewedAt: NOW + 1,
    now: NOW,
  }), false);
  assert.equal(isRecentPublicMediaView({
    lastViewedAt: null,
    now: NOW,
  }), false);
});
