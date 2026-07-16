// src/app/core/interfaces/iuser-dados.ts
import { IUserSocialLinks } from './interfaces-user-dados/iuser-social-links';

export type UserTierRole = 'visitante' | 'free' | 'basic' | 'premium' | 'vip' | 'admin';

export type AccountStatus =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted';

export type PublicVisibility = 'visible' | 'hidden';

export type LifecycleActorSource = 'self' | 'moderator' | 'system';

export type AgeReverificationStatus =
  | 'NONE'
  | 'REQUIRED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type AgeReverificationResult =
  | 'ADULT'
  | 'INCONCLUSIVE'
  | 'UNDERAGE';

export interface IUserAdultConsent {
  accepted: boolean;
  version: string;
  acceptedAt?: number | null;
  updatedAt?: number | null;
  source?: string | null;
}

export interface IUserAgeReverification {
  status: AgeReverificationStatus;
  caseId?: string | null;
  reportId?: string | null;
  source?: 'MINOR_SAFETY_PROFILE_REPORT' | null;
  requestedAt?: number | null;
  dueAt?: number | null;
  submittedAt?: number | null;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  result?: AgeReverificationResult | null;
  method?: 'SELF_DECLARATION_REVIEW' | 'EXTERNAL_PROVIDER' | 'MANUAL_REVIEW' | null;
  declaredAgeBand?: '18_PLUS' | 'UNDER_18' | null;
  resolution?: string | null;
}

export interface IUserTermsAcceptance {
  accepted: boolean;
  date: number | null;
  version?: string | null;
  acceptedAt?: number | null;
  updatedAt?: number | null;
  source?: string | null;
}

export interface IUserDados {
  uid: string;
  nickname?: string | null;
  roomIds?: string[];

  latitude?: number;
  longitude?: number;
  distanciaKm?: number | undefined;

  email: string | null;
  photoURL: string | null | undefined;
  nome?: string;
  idade?: number;

  /**
   * IMPORTANTE:
   * - No projeto atual, role ainda representa o tier/plano do usuário.
   * - Não mudar isso agora, para não quebrar guards, selectors e telas já existentes.
   */
  role: UserTierRole;

  /**
   * Opcional por compat futura.
   * - role continua sendo a fonte legada principal do tier.
   * - tier entra para harmonizar com billing/access control/lifecycle.
   */
  tier?: Exclude<UserTierRole, 'visitante'> | null;

  // ---------------------------------------------------------------------------
  // Datas / sessão (epoch ms)
  // ---------------------------------------------------------------------------
  lastLogin: number;
  firstLogin?: number | null;
  createdAt?: number | null;
  registrationDate?: number | null;
  registrationCompletedAt?: number | null;
  registrationFlowVersion?: string | null;

  emailVerified?: boolean;

  // ---------------------------------------------------------------------------
  // Compliance
  // ---------------------------------------------------------------------------
  adultConsent?: IUserAdultConsent | null;
  acceptedTerms?: IUserTermsAcceptance | null;

  /**
   * Apenas contas criadas no fluxo versionado recebem `true`.
   * Ausência do campo identifica conta legada e não força novo aceite.
   */
  initialAdultConsentRequired?: boolean;

  /**
   * Estado excepcional, independente do aceite inicial, criado somente após
   * decisão administrativa em denúncia de perfil por possível menoridade.
   */
  ageReverification?: IUserAgeReverification | null;
  ageReverificationRestrictedAt?: number | null;

  // ---------------------------------------------------------------------------
  // Perfil
  // ---------------------------------------------------------------------------
  gender?: string;
  orientation?: string;

  /**
   * Campos canônicos de discovery calculados no backend.
   * Devem ter prioridade sobre gender/orientation brutos em filtros e compatibilidade.
   */
  normalizedGender?: string | null;
  normalizedOrientation?: string | null;
  compatibilityReady?: boolean | null;
  interestedInGenders?: readonly string[] | string | null;
  interestedInOrientations?: readonly string[] | string | null;

  partner1Orientation?: string;
  partner2Orientation?: string;
  estado?: string;
  municipio?: string;
  isSidebarOpen?: boolean;
  preferences?: string[];
  descricao: string;

  // ---------------------------------------------------------------------------
  // Estado de presença / uso
  // ---------------------------------------------------------------------------
  isOnline?: boolean;
  isSubscriber: boolean;
  monthlyPayer?: boolean;

  lastSeen?: number | null;
  lastOfflineAt?: number | null;
  lastOnlineAt?: number | null;
  lastLocationAt?: number | null;

  // ---------------------------------------------------------------------------
  // Assinatura / billing
  // ---------------------------------------------------------------------------
  subscriptionStatus?: 'active' | 'inactive' | 'canceled' | 'past_due' | null;
  subscriptionScope?: string | null;
  subscriptionExpires?: number | null;
  lastBillingCheckoutSessionId?: string | null;
  billingUpdatedAt?: number | null;

  singleRoomCreationRightExpires?: number | null;
  roomCreationSubscriptionExpires?: number | null;

  nicknameHistory?: Array<{ nickname: string; date: number | null }>;
  socialLinks?: IUserSocialLinks;
  profileCompleted?: boolean;

  // ---------------------------------------------------------------------------
  // Moderação / lifecycle da conta
  // ---------------------------------------------------------------------------

  /**
   * Campo legado mantido por compatibilidade com fluxos antigos.
   * Futuramente, a verdade canônica deve migrar para accountStatus.
   */
  suspended?: boolean;

  /**
   * Fonte canônica nova para lifecycle da conta.
   */
  accountStatus?: AccountStatus;

  /**
   * Controle de visibilidade pública.
   * - visible: conta pode aparecer nas superfícies públicas
   * - hidden: conta invisível para discovery/busca/perfil público
   */
  publicVisibility?: PublicVisibility;

  /**
   * Bloqueio de interações.
   * Quando true, o usuário não deve conseguir interagir normalmente.
   */
  interactionBlocked?: boolean;

  /**
   * Permite login/sessão mesmo quando a conta está suspensa ou em exclusão pendente.
   * Serve para viabilizar:
   * - visualização da punição
   * - prazo restante
   * - reativação voluntária
   * - cancelamento da exclusão na janela de arrependimento
   */
  loginAllowed?: boolean;

  /**
   * Auditoria mínima do estado atual.
   */
  statusUpdatedAt?: number | null;
  statusUpdatedBy?: string | LifecycleActorSource | null;

  /**
   * Suspensão.
   */
  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | null;
  suspensionEndsAt?: number | null;

  /**
   * Campos legados/compatíveis com serviços de moderação atuais.
   */
  suspendedAtMs?: number | null;
  suspendedBy?: string | null;
  unsuspendedAtMs?: number | null;
  unsuspendedBy?: string | null;

  /**
   * Lock técnico/administrativo já usado por serviços existentes.
   */
  accountLocked?: boolean;
  lockedAtMs?: number | null;
  lockedBy?: string | null;
  unlockedAtMs?: number | null;
  unlockedBy?: string | null;

  /**
   * Exclusão com janela de arrependimento e expurgo posterior.
   */
  deletionRequestedAt?: number | null;
  deletionRequestedBy?: 'self' | 'moderator' | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  deletedAt?: number | null;

  /**
   * Holds de retenção mínima.
   * - legalHold: impede expurgo por obrigação legal/regulatória
   * - billingHold: impede expurgo enquanto houver necessidade operacional/financeira
   */
  legalHold?: boolean;
  billingHold?: boolean;
}
