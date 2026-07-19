import { describe, expect, it } from 'vitest';

import { resolveAccountReauthenticationMode } from './account-reauthentication.service';

describe('resolveAccountReauthenticationMode', () => {
  it('prioriza senha quando a conta possui senha e Google vinculados', () => {
    expect(
      resolveAccountReauthenticationMode(['google.com', 'password'])
    ).toBe('password');
  });

  it('usa Google quando esse é o único provedor compatível', () => {
    expect(resolveAccountReauthenticationMode(['google.com'])).toBe(
      'google'
    );
  });

  it('falha fechado para provedor ainda não suportado', () => {
    expect(resolveAccountReauthenticationMode(['apple.com'])).toBe(
      'unsupported'
    );
    expect(resolveAccountReauthenticationMode([])).toBe('unsupported');
  });
});
