import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canClaimRegistrationNickname, normalizeRegistrationNickname,
  normalizeRegistrationNicknameClaim, resolveStoredRegistrationNickname,
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
test('registration reserves the principal independent of case and complement', () => {
  assert.deepEqual(normalizeRegistrationNicknameClaim('ApelidoTeste Complemento1'), {
    display: 'ApelidoTeste Complemento1', key: 'apelidoteste',
  });
  assert.equal(normalizeRegistrationNicknameClaim('RAFA RJ')?.key, 'rafa');
  assert.equal(normalizeRegistrationNicknameClaim('Rafa Oficial')?.key, 'rafa');
  assert.equal(normalizeRegistrationNicknameClaim('Rafa_RJ')?.key, 'rafa_rj');
  for (const invalid of ['Raf Oficial', 'NomeMuitolongo', 'Rafa Com Dois', 'Rafa ' + 'A'.repeat(13)]) {
    assert.equal(normalizeRegistrationNicknameClaim(invalid), null);
  }
});
test('stored legacy aliases and principal-based registrations resume with their persisted key', () => {
  assert.equal(resolveStoredRegistrationNickname('Rafa Oficial', undefined)?.key, 'rafa_oficial');
  assert.equal(resolveStoredRegistrationNickname('Rafa Oficial', 'rafa_oficial')?.key, 'rafa_oficial');
  assert.equal(resolveStoredRegistrationNickname('Rafa Oficial', 'rafa')?.key, 'rafa');
});
test('the index owner blocks cross-user occupation', () => {
  const requested = normalizeRegistrationNickname('Perfil Oficial')!;
  assert.equal(canClaimRegistrationNickname({
    uid: 'owner', requested, indexOwnerUid: 'other',
  }), 'in-use');
  assert.equal(canClaimRegistrationNickname({
    uid: 'owner', requested, indexOwnerUid: 'owner',
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
