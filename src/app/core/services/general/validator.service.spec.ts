import { FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { ValidatorService } from './validator.service';

describe('ValidatorService password validators', () => {
  it('aceita senha com tamanho, maiúscula, minúscula e número', () => {
    const control = new FormControl('Senha123');

    expect(ValidatorService.passwordValidator(8)(control)).toBeNull();
    expect(ValidatorService.isValidPassword('Senha123')).toBe(true);
  });

  it('rejeita senha fraca ou presente na blacklist', () => {
    const weak = new FormControl('12345678');
    const blacklisted = new FormControl('Password1');

    expect(ValidatorService.passwordValidator(8)(weak)).toEqual({
      invalidPassword: true,
    });
    expect(ValidatorService.passwordValidator(8)(blacklisted)).toEqual({
      invalidPassword: true,
    });
  });

  it('compara senha e confirmação sem alterar os controles', () => {
    const form = new FormGroup({
      password: new FormControl('Senha123'),
      confirmPassword: new FormControl('Outra123'),
    });
    const validator = ValidatorService.passwordsMatchValidator();

    expect(validator(form)).toEqual({ passwordMismatch: true });
    expect(form.get('password')?.errors).toBeNull();
    expect(form.get('confirmPassword')?.errors).toBeNull();

    form.get('confirmPassword')?.setValue('Senha123');
    expect(validator(form)).toBeNull();
  });
});
