import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canClaimRegistrationNickname, normalizeRegistrationNickname,
} from './nickname-reservation.policy';

test('backend canonicalizes case and spaces to the same exclusive key', () => {
  assert.deepEqual(normalizeRegistrationNickname('  Perfil   Oficial  '), {
    display: 'Perfil Oficial', key: 'perfil_oficial',
  });
  assert.deepEqual(normalizeRegistrationNickname('perfil_oficial'), {
    display: 'perfil_oficial', key: 'perfil_oficial',
  });
});
test('server refuses malformed or alternate unicode lookalikes', () => {
  for (const value of ['ab', 'apelido/forjado', 'Jõao', 'A'.repeat(25), `${'A'.repeat(13)} ${'B'.repeat(11)}`, null]) {
    assert.equal(normalizeRegistrationNickname(value), null);
  }
});
test('server accepts two 12-character parts and keeps the separator in the display', () => {
  assert.deepEqual(normalizeRegistrationNickname('ApelidoTeste Complemento1'), {
    display: 'ApelidoTeste Complemento1', key: 'apelidoteste_complemento1',
  });
});
test('existing index and server-only reservation both block cross-user occupation', () => {
  const requested = normalizeRegistrationNickname('Perfil Oficial')!;
  for (const owners of [{ indexOwnerUid: 'other' }, { reservationOwnerUid: 'other' }]) {
    assert.equal(canClaimRegistrationNickname({ uid: 'owner', requested, ...owners }), 'in-use');
  }
  assert.equal(canClaimRegistrationNickname({
    uid: 'owner', requested, indexOwnerUid: 'owner', reservationOwnerUid: 'owner',
  }), 'allowed');
});
test('idempotence cannot rename existing nickname or completed profile', () => {
  const requested = normalizeRegistrationNickname('Perfil Oficial')!;
  assert.equal(canClaimRegistrationNickname({
    uid: 'owner', requested, currentDisplay: 'Outro Perfil',
  }), 'name-changed');
  assert.equal(canClaimRegistrationNickname({
    uid: 'owner', requested, currentDisplay: 'Perfil Oficial', completed: true,
  }), 'account-completed');
});
