import assert from 'node:assert/strict';
import {test} from 'node:test';

import {buildPrivatePushContent} from './push-notification-content.policy';

test('usa conteúdo neutro no Web Push externo', () => {
  assert.deepEqual(buildPrivatePushContent(), {
    title: 'Entretenimento',
    body: 'Você tem uma nova notificação.',
  });
});
