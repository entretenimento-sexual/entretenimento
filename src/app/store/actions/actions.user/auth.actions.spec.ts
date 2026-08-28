// src/app/store/actions/actions.user/auth.actions.spec.ts
import { registerSuccess } from './auth.actions';

describe('auth actions serializability', () => {
  it('registerSuccess deve transportar apenas dados simples do usuário Firebase', () => {
    const action = registerSuccess({
      uid: 'user-1',
      emailVerified: false,
    });

    expect(action).toEqual({
      type: '[Auth] Register Success',
      uid: 'user-1',
      emailVerified: false,
    });
    expect('user' in action).toBe(false);
    expect(JSON.parse(JSON.stringify(action))).toEqual(action);
  });
});
