// src/app/core/interfaces/iuser-registration-data.ts
import { IUserDados, IUserTermsAcceptance } from './iuser-dados';

export interface IUserRegistrationData {
  uid?: string;                 // preenchido depois do registro, se precisar
  email: string;
  nickname: string;
  photoURL?: string;

  // ✅ role inicial (opcional, mas permite o RegisterService definir no persist)
  role?: IUserDados['role']; // 'visitante' | 'free' | 'basic' | 'premium' | 'vip'

  emailVerified: boolean;
  isSubscriber: boolean;

  estado?: string;
  municipio?: string;
  municipioEstado?: string;

  // 🔁 agora como epoch (ms)
  firstLogin: number;           // ex.: Date.now()
  registrationDate?: number | null;

  latitude?: number;
  longitude?: number;
  gender?: string;
  orientation?: string;

  /**
   * Confirmação explícita pré-Auth. Obrigatória no registro com email/senha.
   * Não é autoridade de idade: a permissão usa age_eligibility_records/{uid}.
   * Opcional no tipo para não alterar contratos de integração existentes;
   * RegisterService rejeita qualquer valor que não seja literalmente true.
   */
  confirmsAdult?: boolean;

  acceptedTerms: IUserTermsAcceptance;

  profileCompleted?: boolean;
}
// lembrar sempre da padronização em uid para usuários, o identificador canônico.
