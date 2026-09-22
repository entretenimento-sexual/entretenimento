import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isConfirmedModerationViolation,
  isCriticalModerationSafetyReason,
  isTerminalModerationReportStatus,
  resolveModerationAutomationSubjectUid,
} from './moderation-automation-event.model';

describe('moderation automation event model', () => {
  it('trata segurança de menores como sinal crítico', () => {
    assert.equal(isCriticalModerationSafetyReason('minor_safety'), true);
    assert.equal(
      isCriticalModerationSafetyReason('minor_content_safety'),
      true
    );
    assert.equal(isCriticalModerationSafetyReason('spam'), false);
  });

  it('resolve autor antes do proprietário como sujeito do risco', () => {
    assert.equal(
      resolveModerationAutomationSubjectUid({
        targetAuthorUid: 'author-1',
        targetOwnerUid: 'owner-1',
      }),
      'author-1'
    );
  });

  it('usa o perfil alvo como sujeito quando a denúncia é de perfil', () => {
    assert.equal(
      resolveModerationAutomationSubjectUid({
        targetType: 'profile',
        targetId: 'profile-user',
      }),
      'profile-user'
    );
  });

  it('só considera infração confirmada quando a decisão remove o alvo', () => {
    assert.equal(
      isConfirmedModerationViolation({ moderationAction: 'REMOVE' }),
      true
    );
    assert.equal(
      isConfirmedModerationViolation({ moderationAction: 'KEEP' }),
      false
    );
    assert.equal(
      isConfirmedModerationViolation({ status: 'resolved' }),
      false
    );
  });

  it('reconhece apenas status finais da denúncia', () => {
    assert.equal(isTerminalModerationReportStatus('resolved'), true);
    assert.equal(isTerminalModerationReportStatus('rejected'), true);
    assert.equal(isTerminalModerationReportStatus('reviewing'), false);
  });
});
