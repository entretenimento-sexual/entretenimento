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
   * Role continua sendo compatibilidade de autorização/tier já usada em telas.
   * A situação financeira nunca deve ser inferida apenas deste campo.
   */
  role: UserTierRole;

  /**
   * Tier operacional projetado pelo backend.
   * Para assinatura, deve ser combinado com a projeção canônica versionada.
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
   * Estado excepcional criado após decisão administrativa em denúncia de
   * perfil por possível menoridade.
   */
  ageReverification?: IUserAgeReverification | null;
  ageReverificationRestrictedAt?: number | null;

  // ---------------------------------------------------------------------------
  // Perfil
  // ---------------------------------------------------------------------------
  gender?: string;
  orientation?: string;

  /** Campos canônicos de discovery calculados no backend. */
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

  /** Alias legado, sincronizado pela projeção canônica. */
  monthlyPayer?: boolean;

  lastSeen?: number | null;
  lastOfflineAt?: number | null;
  lastOnlineAt?: number | null;
  lastLocationAt?: number | null;

  // ---------------------------------------------------------------------------
  // Assinatura / billing — projeção operacional do entitlement
  // ---------------------------------------------------------------------------
  billingProjectionVersion?: number | null;
  subscriptionStatus?: 'active' | 'inactive' | 'canceled' | 'past_due' | null;
  subscriptionScope?: string | null;
  subscriptionStartedAt?: number | null;
  subscriptionEndsAt?: number | null;

  /** Alias legado de subscriptionEndsAt. */
  subscriptionExpires?: number | null;

  lastBillingCheckoutSessionId?: string | null;
  lastBillingTransactionId?: string | null;
  billingUpdatedAt?: number | null;

  singleRoomCreationRightExpires?: number | null;
  roomCreationSubscriptionExpires?: number | null;

  nicknameHistory?: Array<{ nickname: string; date: number | null }>;
  socialLinks?: IUserSocialLinks;
  profileCompleted?: boolean;

  // ---------------------------------------------------------------------------
  // Moderação / lifecycle da conta
  // ---------------------------------------------------------------------------

  /** Campo legado mantido por compatibilidade com fluxos antigos. */
  suspended?: boolean;

  /** Fonte canônica para lifecycle da conta. */
  accountStatus?: AccountStatus;

  /** Controle de visibilidade pública. */
  publicVisibility?: PublicVisibility;

  /** Bloqueio de interações. */
  interactionBlocked?: boolean;

  /**
   * Permite login/sessão em estados restritos para mostrar punição, prazo,
   * reativação ou cancelamento da exclusão.
   */
  loginAllowed?: boolean;

  /** Auditoria mínima do estado atual. */
  statusUpdatedAt?: number | null;
  statusUpdatedBy?: string | LifecycleActorSource | null;

  /** Suspensão. */
  suspensionReason?: string | null;
  suspensionSource?: 'self' | 'moderator' | null;
  suspensionEndsAt?: number | null;

  /** Campos legados/compatíveis com serviços de moderação atuais. */
  suspendedAtMs?: number | null;
  suspendedBy?: string | null;
  unsuspendedAtMs?: number | null;
  unsuspendedBy?: string | null;

  /** Lock técnico/administrativo. */
  accountLocked?: boolean;
  lockedAtMs?: number | null;
  lockedBy?: string | null;
  unlockedAtMs?: number | null;
  unlockedBy?: string | null;

  /** Exclusão com janela de arrependimento e expurgo posterior. */
  deletionRequestedAt?: number | null;
  deletionRequestedBy?: 'self' | 'moderator' | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  deletedAt?: number | null;

  /** Holds de retenção mínima. */
  legalHold?: boolean;
  billingHold?: boolean;
}
