// src/app/core/services/general/validator.service.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
// Este serviço centraliza validações de formato e regras de negócio simples (e.g., regex, tamanho, blacklist).
// Ele NÃO deve conter validações que dependam de chamadas assíncronas ou do estado do backend (e.g., checar se um nickname já existe).
// Validações que envolvem backend devem ser tratadas em serviços específicos (como o FirestoreValidationService) e integradas na camada de UI de forma adequada (e.g., usando AsyncValidators no Angular).
import { Injectable } from '@angular/core';
import { AbstractControl, ValidatorFn } from '@angular/forms';

// ✅ Centraliza a regra de "KEY/índice" (sem espaços) em um único lugar.
import { NicknameUtils } from '@core/utils/nickname-utils';

// -----------------------------------------------------------------------------
// Expressões regulares para validação
// -----------------------------------------------------------------------------
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const FACEBOOK_REGEX = /^https?:\/\/www\.facebook\.com\/.+$/;
const INSTAGRAM_REGEX = /^https:\/\/www\.instagram\.com\/.+$/;
// trocar pra hotvips
const BUUPE_REGEX = /^https:\/\/www\.buupe\.com\/.+$/;

// Obs.: Esta constante é mantida como documentação da política canônica.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*(),.?":{}|<>_-]{8,}$/;
const PASSWORD_BLACKLIST = ['password', '123456', 'qwerty', '111111', '000000'];

// -----------------------------------------------------------------------------
// Nickname (DISPLAY vs KEY/índice)
// - DISPLAY: permite letras sem acento e um espaço separando principal e complemento.
// - KEY/índice: precisa ser compatível com Firestore docId e rules (sem espaço).
//   Por isso validamos também a normalização via NicknameUtils.
// -----------------------------------------------------------------------------

// Blocos (principal e complemento): sem espaços.
const NICK_BLOCK_RE = /^[A-Za-z0-9._-]+$/;

@Injectable({ providedIn: 'root' })
export class ValidatorService {

  constructor() { }

  // ---------------------------------------------------------------------------
  // E-mail
  // ---------------------------------------------------------------------------

  /** Validação de E-mail como função utilitária estática. */
  public static isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email);
  }

  /** Validação de E-mail como ValidatorFn para Reactive Forms. */
  public static emailValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const email = control.value;
      return email && !EMAIL_REGEX.test(email) ? { invalidEmail: { value: email } } : null;
    };
  }

  // ---------------------------------------------------------------------------
  // Nickname (principal / complemento / full)
  // ---------------------------------------------------------------------------

  /**
   * Valida o apelido PRINCIPAL (campo isolado).
   * - Não permite espaços.
   * - Permite letras sem acento, números e separadores (. _ -).
   * - Range de tamanho: 4..12 (mantendo sua regra atual).
   */
  public static nicknameValidator(minLength = NicknameUtils.DISPLAY_MIN_LEN): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = (control.value ?? '').toString().trim();
      if (!value) return minLength > 1 ? { required: true } : null;

      if (value.length < minLength) {
        return { minlength: { requiredLength: minLength, actualLength: value.length } };
      }
      if (value.length > NicknameUtils.DISPLAY_PART_MAX_LEN) return { invalidNickname: true };
      if (!NICK_BLOCK_RE.test(value)) return { invalidNickname: true };

      return null;
    };
  }

  /**
   * Valida o COMPLEMENTO do apelido (campo isolado).
   * - Não permite espaços.
   * - Permite letras sem acento, números e separadores (. _ -).
   * - Range de tamanho: 0..12 (mantendo sua regra atual).
   */
  public static complementoNicknameValidator(): ValidatorFn {
    return ValidatorService.nicknameValidator(1);
  }

  /**
   * Valida o APELIDO COMPLETO (grupo):
   * - Monta: principal + " " + complemento (se houver).
   * - DISPLAY: permite 1 espaço entre os blocos (principal/complemento).
   * - Também valida a "KEY/índice" (nicknameNormalized) via NicknameUtils:
   *   isso garante que o que o usuário digitou será transformável em um identificador
   *   compatível com o `public_index/nickname:<key>` e com as rules.
   *
   * ⚠️ Mantemos a chave de erro { invalidFullNickname: true } para não quebrar UI atual.
   */
  public static fullNicknameValidator(): ValidatorFn {
    return (group: AbstractControl): { [key: string]: any } | null => {
      const apelido = group.get('apelidoPrincipal');
      const complemento = group.get('complementoApelido');

      // Erros de cada campo têm precedência sobre a validação da composição.
      if (!apelido?.value || apelido.invalid || complemento?.invalid) return null;

      const fullDisplay = NicknameUtils.montarApelidoCompleto(apelido.value, complemento?.value ?? '');
      return NicknameUtils.isApelidoValido(fullDisplay) && NicknameUtils.isApelidoIndiceValido(fullDisplay)
        ? null
        : { invalidFullNickname: true };
    };
  }

  // ---------------------------------------------------------------------------
  // Senha
  // ---------------------------------------------------------------------------

  /** Validação de Senha como ValidatorFn para Reactive Forms. */
  public static passwordValidator(minLength: number = 8): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const password = String(control.value ?? '');

      if (!password) return null;

      const passwordRegex = minLength === 8
        ? PASSWORD_REGEX
        : new RegExp(
          `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`
        );

      const isBlacklisted = PASSWORD_BLACKLIST.includes(password.toLowerCase());
      const isInvalidByRegex = !passwordRegex.test(password);

      return (isInvalidByRegex || isBlacklisted)
        ? { invalidPassword: true }
        : null;
    };
  }

  /**
   * Compara senha e confirmação no FormGroup sem copiar a senha para outro estado.
   * Campos vazios ficam sob responsabilidade de Validators.required.
   */
  public static passwordsMatchValidator(
    passwordControlName: string = 'password',
    confirmationControlName: string = 'confirmPassword'
  ): ValidatorFn {
    return (group: AbstractControl): { [key: string]: boolean } | null => {
      const password = String(group.get(passwordControlName)?.value ?? '');
      const confirmation = String(
        group.get(confirmationControlName)?.value ?? ''
      );

      if (!password || !confirmation) return null;
      return password === confirmation ? null : { passwordMismatch: true };
    };
  }

  /** Validação de Senha como função utilitária estática. */
  public static isValidPassword(password: string, minLength: number = 8): boolean {
    const passwordRegex = minLength === 8
      ? PASSWORD_REGEX
      : new RegExp(
        `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`
      );
    return passwordRegex.test(password) && !PASSWORD_BLACKLIST.includes(password.toLowerCase());
  }

  // ---------------------------------------------------------------------------
  // URLs
  // ---------------------------------------------------------------------------

  /** Validação de URL do Facebook. */
  public static facebookValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const facebookUrl = control.value;
      return !facebookUrl || FACEBOOK_REGEX.test(facebookUrl) ? null : { invalidFacebook: { value: facebookUrl } };
    };
  }

  /** Validação de URL do Instagram. */
  public static instagramValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const instagramUrl = control.value;
      return !instagramUrl || INSTAGRAM_REGEX.test(instagramUrl) ? null : { invalidInstagram: { value: instagramUrl } };
    };
  }

  /** Validação de URL do B.uupe.
   *trocar pra hotvips depois que tiver o domínio e regras definidas.
   */
  public static buupeValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const buupeUrl = control.value;
      return !buupeUrl || BUUPE_REGEX.test(buupeUrl) ? null : { invalidBuupe: { value: buupeUrl } };
    };
  }

  // ---------------------------------------------------------------------------
  // CPF
  // ---------------------------------------------------------------------------

  /** Validação de CPF (simples, sem dígito verificador). */
  public static cpfValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const cpf = control.value;
      const cpfRegex = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/; // Formato 999.999.999-99
      return cpf && !cpfRegex.test(cpf) ? { invalidCPF: { value: cpf } } : null;
    };
  }
}

/*
Observação importante: este ValidatorService é focado em validações de formato e regras de negócio simples (e.g., regex, tamanho, blacklist).
Ele não deve conter validações que dependam de chamadas assíncronas ou do estado do backend (e.g., checar se um nickname já existe).
Validações que envolvem backend devem ser tratadas em serviços específicos (como o FirestoreValidationService) e integradas na camada de UI de forma adequada (e.g., usando AsyncValidators no Angular).
*/
