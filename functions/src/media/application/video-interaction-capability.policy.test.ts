import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVideoInteractionCapability,
  type VideoInteractionCapability,
} from './video-interaction-capability.policy';

const capabilities: readonly VideoInteractionCapability[] = [
  'REACTION',
  'COMMENT',
  'RATING',
];

function enabledDocument(capability: VideoInteractionCapability) {
  return {
    reactionsEnabled: capability === 'REACTION',
    commentsEnabled: capability === 'COMMENT',
    ratingsEnabled: capability === 'RATING',
  };
}

for (const capability of capabilities) {
  test(`${capability}: permite somente quando publicação e projeção concordam`, () => {
    const enabled = enabledDocument(capability);

    assert.deepEqual(
      evaluateVideoInteractionCapability({
        capability,
        publicVideo: enabled,
        publication: enabled,
      }),
      { allowed: true, reason: null }
    );
  });

  test(`${capability}: bloqueia quando a interação está desabilitada nas duas fontes`, () => {
    assert.deepEqual(
      evaluateVideoInteractionCapability({
        capability,
        publicVideo: {},
        publication: {},
      }),
      { allowed: false, reason: 'interaction_disabled' }
    );
  });

  test(`${capability}: bloqueia divergência entre publicação e projeção`, () => {
    assert.deepEqual(
      evaluateVideoInteractionCapability({
        capability,
        publicVideo: enabledDocument(capability),
        publication: {},
      }),
      { allowed: false, reason: 'settings_inconsistent' }
    );

    assert.deepEqual(
      evaluateVideoInteractionCapability({
        capability,
        publicVideo: {},
        publication: enabledDocument(capability),
      }),
      { allowed: false, reason: 'settings_inconsistent' }
    );
  });
}
