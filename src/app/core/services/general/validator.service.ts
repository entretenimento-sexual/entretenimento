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
const BUUPE_REGEX = /^https:\/\/www\.buupe\.com\/.+$/;

// Obs.: Estas constantes existiam, mas você hoje usa regex gerada dentro do passwordValidator.
// Mantidas para referência/coerência do arquivo.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%^&*(),.?":{}|<>_-]{8,}$/;
const PASSWORD_BLACKLIST = ['password', '123456', 'qwerty', '111111', '000000'];

// -----------------------------------------------------------------------------
// Nickname (DISPLAY vs KEY/índice)
// - DISPLAY: pode conter caracteres humanos (inclui letras com acento) e, no FULL,
//   pode ter 1 espaço separando principal e complemento.
// - KEY/índice: precisa ser compatível com Firestore docId e rules (sem espaço).
//   Por isso validamos também a normalização via NicknameUtils.
// -----------------------------------------------------------------------------

// Blocos (principal e complemento): sem espaços.
// Permitimos letras (Unicode), números e separadores simples (. _ -).
const NICK_BLOCK_RE = /^[\p{L}\p{N}._-]+$/u;

// FULL DISPLAY: um ou dois blocos, separados por 1 espaço, sem espaço no começo/fim.
// Ex.: "Joao" ou "Joao Oficial"
const NICK_FULL_DISPLAY_RE = /^[\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)?$/u;

// KEY/índice: compatível com sua regra de public_profiles.rules (nicknameNormalized)
// (aqui validamos a string já normalizada para índice)
const NICK_KEY_RE = /^[a-z0-9._-]{3,40}$/;

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
   * - Permite letras (com acento), números e separadores (. _ -).
   * - Range de tamanho: 4..12 (mantendo sua regra atual).
   */
  public static nicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = (control.value ?? '').toString().trim();
      if (!value) return null;

      if (value.length < 4 || value.length > 12) return { invalidNickname: true };
      if (!NICK_BLOCK_RE.test(value)) return { invalidNickname: true };

      return null;
    };
  }

  /**
   * Valida o COMPLEMENTO do apelido (campo isolado).
   * - Não permite espaços.
   * - Permite letras (com acento), números e separadores (. _ -).
   * - Range de tamanho: 0..12 (mantendo sua regra atual).
   */
  public static complementoNicknameValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const value = (control.value ?? '').toString().trim();
      if (!value) return null;

      if (value.length > 12) return { invalidNickname: true };
      if (!NICK_BLOCK_RE.test(value)) return { invalidNickname: true };

      return null;
    };
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
      const apelido = (group.get('apelidoPrincipal')?.value ?? '').toString().trim();
      const complemento = (group.get('complementoApelido')?.value ?? '').toString().trim();

      // Se não tem principal, não é função deste validator (required lida com isso).
      if (!apelido) return null;

      // Monta DISPLAY com 1 espaço apenas quando existir complemento.
      const fullDisplay = complemento ? `${apelido} ${complemento}` : apelido;

      // 1) Validação do DISPLAY (user-facing)
      if (fullDisplay.length < 4 || fullDisplay.length > 24) return { invalidFullNickname: true };
      if (!NICK_FULL_DISPLAY_RE.test(fullDisplay)) return { invalidFullNickname: true };

      // 2) Validação da KEY/índice (backend-facing)
      // Espaços do DISPLAY são convertidos internamente (ex.: "joao oficial" -> "joao_oficial").
      const key = NicknameUtils.normalizarApelidoParaIndice(fullDisplay);
      if (!key || !NICK_KEY_RE.test(key)) return { invalidFullNickname: true };

      return null;
    };
  }

  // ---------------------------------------------------------------------------
  // Senha
  // ---------------------------------------------------------------------------

  /** Validação de Senha como ValidatorFn para Reactive Forms. */
  public static passwordValidator(minLength: number = 8): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
      const password = control.value;

      if (!password) return null;

      const passwordRegex = new RegExp(
        `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`
      );

      const isBlacklisted = PASSWORD_BLACKLIST.includes(password);
      const isInvalidByRegex = !passwordRegex.test(password);

      return (isInvalidByRegex || isBlacklisted)
        ? { invalidPassword: { value: password } }
        : null;
    };
  }

  /** Validação de Senha como função utilitária estática. */
  public static isValidPassword(password: string, minLength: number = 8): boolean {
    const passwordRegex = new RegExp(
      `^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d!@#$%^&*(),.?":{}|<>_-]{${minLength},}$`
    );
    return passwordRegex.test(password) && !PASSWORD_BLACKLIST.includes(password);
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

  /** Validação de URL do Buupe. */
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
} // 211 linhas - Fim do ValidatorService

/*
Observação importante: este ValidatorService é focado em validações de formato e regras de negócio simples (e.g., regex, tamanho, blacklist).
Ele não deve conter validações que dependam de chamadas assíncronas ou do estado do backend (e.g., checar se um nickname já existe).
Validações que envolvem backend devem ser tratadas em serviços específicos (como o FirestoreValidationService) e integradas na camada de UI de forma adequada (e.g., usando AsyncValidators no Angular).
*/
