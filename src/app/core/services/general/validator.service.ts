//src\app\core\services\general\validator.service.ts
// Não esqueça os comentários explicativos.
import { Injectable } from '@angular/core';
import { AbstractControl, ValidatorFn } from '@angular/forms';

// Definindo expressões regulares para validação
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const FACEBOOK_REGEX = /^https?:\/\/www\.facebook\.com\/.+$/;
const INSTAGRAM_REGEX = /^https:\/\/www\.instagram\.com\/.+$/;
const BUUPE_REGEX = /^https:\/\/www\.buupe\.com\/.+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*(),.?":{}|<>_-]{8,}$/;
const PASSWORD_BLACKLIST = ['password', '123456', 'qwerty', '111111', '000000'];

@Injectable({
  providedIn: 'root'
})
export class ValidatorService {

  constructor() { }

  // Validação de E-mail como função utilitária estática
  public static isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }

  public static nicknameValidator(): ValidatorFn {
    const regex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{4,12}$/;
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = control.value?.trim();
      return value && !regex.test(value) ? { invalidNickname: true } : null;
    };
  }

  public static complementoNicknameValidator(): ValidatorFn {
    const regex = /^[a-zA-Z0-9!@#$%^&*()_+\-=]{0,12}$/;
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = control.value?.trim();
      return value && !regex.test(value) ? { invalidNickname: true } : null;
    };
  }

  public static fullNicknameValidator(): ValidatorFn {
    return (group: AbstractControl): { [key: string]: any } | null => {
      const apelido = group.get('apelidoPrincipal')?.value?.trim() || '';
      const complemento = group.get('complementoApelido')?.value?.trim() || '';
      const full = `${apelido} ${complemento}`.trim();

      const regex = /^[a-zA-Z0-9!@#$%^&*()_+\-= ]{4,24}$/;

      return !regex.test(full) ? { invalidFullNickname: true } : null;
    };
  }

  // Validação de E-mail como ValidatorFn para Reactive Forms
  public static emailValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const email = control.value;
      return email && !EMAIL_REGEX.test(email) ? { 'invalidEmail': { value: email } } : null;
    };
  }

  // Validação de Senha como ValidatorFn para Reactive Forms
  public static passwordValidator(minLength: number = 8): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const password = control.value;
      const passwordRegex = new RegExp(`^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`);
      return password && !passwordRegex.test(password) || PASSWORD_BLACKLIST.includes(password)
        ? { 'invalidPassword': { value: password } }
        : null;
    };
  }

  // Validação de URL do Facebook
  public static facebookValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const facebookUrl = control.value;
      return !facebookUrl || FACEBOOK_REGEX.test(facebookUrl) ? null : { 'invalidFacebook': { value: facebookUrl } };
    };
  }

  // Validação de URL do Instagram
  public static instagramValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const instagramUrl = control.value;
      return !instagramUrl || INSTAGRAM_REGEX.test(instagramUrl) ? null : { 'invalidInstagram': { value: instagramUrl } };
    };
  }

  // Validação de URL do Buupe
  public static buupeValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const buupeUrl = control.value;
      return !buupeUrl || BUUPE_REGEX.test(buupeUrl) ? null : { 'invalidBuupe': { value: buupeUrl } };
    };
  }

  // Validação de Senha como função utilitária estática
  public static isValidPassword(password: string, minLength: number = 8): boolean {
    const passwordRegex = new RegExp(`^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`);
    return passwordRegex.test(password) && !PASSWORD_BLACKLIST.includes(password);
  }

  // Validação de CPF (Simples, sem validação de dígito verificador)
  public static cpfValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const cpf = control.value;
      const cpfRegex = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/; // Formato 999.999.999-99
      return cpf && !cpfRegex.test(cpf) ? { 'invalidCPF': { value: cpf } } : null;
    };
  }

  // Adicionar outros validadores conforme necessário
}
