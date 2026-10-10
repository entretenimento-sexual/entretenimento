import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT,
  ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
  assertCanCreateNewDirectChat,
  isEligibleExistingDirectChat,
} from './direct-chat.policy';
import { buildBackendFixedWindowRateLimitDecision } from '../../../shared/security/backend-fixed-window-rate-limit';

const PAIR = ['user-a', 'user-b'] as const;

describe('ensureDirectChat canonical pair policy', () => {
  it('aceita conversa direta válida e legado sem status explícito', () => {
    assert.equal(isEligibleExistingDirectChat({
      participants: ['user-b', 'user-a'],
      conversationType: 'direct',
      conversationStatus: 'active',
      isRoom: false,
    }, PAIR), true);
    assert.equal(isEligibleExistingDirectChat({
      participants: ['user-a', 'user-b'],
    }, PAIR), true);
  });

  const malformed = [
    { participants: ['user-a', 'user-b', 'user-b'] },
    { participants: ['user-a', 'user-a'] },
    { participants: ['user-a', 42] },
    { participants: ['user-a', 'user-b'], isRoom: true },
    { participants: ['user-a', 'user-b'], conversationType: 'room' },
    { participants: ['user-a', 'user-b'], conversationStatus: 'archived' },
    { participants: ['user-a', 'different'] },
    { participants: ['user-a', 'user-b', 'extra'] },
    { participants: ['user-a', 'user-b'], conversationStatus: 'blocked' },
  ];
  for (const document of malformed) {
    it('rejeita documento malformado ou incompatível com o par', () => {
      assert.equal(isEligibleExistingDirectChat(document, PAIR), false);
    });
  }

  it('exige consentimento social bilateral mesmo em histórico legado', () => {
    assert.throws(() => assertCanCreateNewDirectChat({
      actorHasAcceptedFriendEdge: true,
      targetHasAcceptedFriendEdge: false,
    }), (error: any) => error?.code === 'failed-precondition');
  });

  it('limita transições de abertura na quota compartilhada', () => {
    assert.equal(ENSURE_DIRECT_CHAT_LEGACY_SCAN_LIMIT > 10, true);
    let state: ReturnType<typeof buildBackendFixedWindowRateLimitDecision>['nextState'] | undefined;
    for (let i = 0; i < ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG.burstMax; i++) {
      const decision = buildBackendFixedWindowRateLimitDecision({
        now: 100000 + i,
        state,
        config: ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
      });
      assert.equal(decision.allowed, true);
      state = decision.nextState;
    }
    assert.equal(buildBackendFixedWindowRateLimitDecision({
      now: 100500,
      state,
      config: ENSURE_DIRECT_CHAT_RATE_LIMIT_CONFIG,
    }).allowed, false);
  });
});
