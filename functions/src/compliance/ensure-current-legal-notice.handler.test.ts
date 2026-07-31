import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TERMS_ACCEPTANCE_VERSION } from './platform-legal.constants';
import { resolveLegalAcceptanceState } from './ensure-current-legal-notice.handler';

describe('legal update notice eligibility', () => {
  it('não notifica usuário novo sem aceite anterior', () => {
    assert.deepEqual(resolveLegalAcceptanceState(null), {
      current: false,
      hasPriorAcceptance: false,
      previousVersion: null,
    });

    assert.deepEqual(
      resolveLegalAcceptanceState({ accepted: false }),
      {
        current: false,
        hasPriorAcceptance: false,
        previousVersion: null,
      }
    );
  });

  it('notifica somente usuário com versão anterior aceita', () => {
    assert.deepEqual(
      resolveLegalAcceptanceState({
        accepted: true,
        version: 'v2',
        acknowledgedPrivacyNotice: true,
      }),
      {
        current: false,
        hasPriorAcceptance: true,
        previousVersion: 'v2',
      }
    );
  });

  it('não cria pendência quando a versão atual já foi aceita', () => {
    assert.deepEqual(
      resolveLegalAcceptanceState({
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      }),
      {
        current: true,
        hasPriorAcceptance: true,
        previousVersion: TERMS_ACCEPTANCE_VERSION,
      }
    );
  });

  it('exige correção quando falta ciência da Política de Privacidade', () => {
    assert.deepEqual(
      resolveLegalAcceptanceState({
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
      }),
      {
        current: false,
        hasPriorAcceptance: true,
        previousVersion: TERMS_ACCEPTANCE_VERSION,
      }
    );
  });
});
