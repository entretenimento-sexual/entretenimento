// src/app/core/interfaces/iuser-dados.ts
import { IUserSocialLinks } from './interfaces-user-dados/iuser-social-links';
import { IUserDiscoveryPreferences } from './preferences/user-discovery-preferences.interface';

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

export type TermsAcceptanceContext = 'initial' | 'material_update';

export interface IUserTermsAcceptance {
  accepted: boolean;
  date: number | null;
  version?: string | null;
  termsDocumentVersion?: string | null;
  privacyNoticeVersion?: string | null;
  acknowledgedPrivacyNotice?: boolean | null;
  adultAccessAcknowledgement?: boolean | null;
  acceptanceContext?: TermsAcceptanceContext | null;
  previousVersion?: string | null;
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

  /** Características que o próprio usuário escolheu declarar sobre si. */
  bodyTraits?: readonly string[] | null;

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
  // Lifecycle / moderação
  // ---------------------------------------------------------------------------
  accountStatus?: AccountStatus | string | null;
  publicVisibility?: PublicVisibility | null;
  interactionBlocked?: boolean | null;
  loginAllowed?: boolean | null;
  suspended?: boolean | null;
  accountLocked?: boolean | null;
  suspensionReason?: string | null;
  suspensionSource?: LifecycleActorSource | null;
  suspensionEndsAt?: number | null;
  suspendedAtMs?: number | null;
  suspendedBy?: string | null;
  deletionRequestedAt?: number | null;
  deletionRequestedBy?: LifecycleActorSource | null;
  deletionUndoUntil?: number | null;
  purgeAfter?: number | null;
  statusUpdatedAt?: number | null;
  statusUpdatedBy?: string | null;

  // ---------------------------------------------------------------------------
  // Assinatura e projeções financeiras
  // ---------------------------------------------------------------------------
  isSubscriber?: boolean;
  monthlyPayer?: boolean;
  subscriptionStatus?: string | null;
  subscriptionScope?: string | null;
  subscriptionStartedAt?: number | null;
  subscriptionEndsAt?: number | null;
  subscriptionExpires?: number | null;
  billingUpdatedAt?: number | null;
  roomCreationSubscriptionExpires?: number | null;
  singleRoomCreationRightExpires?: number | null;

  // ---------------------------------------------------------------------------
  // Perfil / descoberta
  // ---------------------------------------------------------------------------
  profileCompleted?: boolean;
  discoveryPreferences?: IUserDiscoveryPreferences | null;
  socialLinks?: IUserSocialLinks | null;
  estado?: string | null;
  municipio?: string | null;
  genero?: string | null;
  orientacaoSexual?: string | null;

  // ---------------------------------------------------------------------------
  // Presença
  // ---------------------------------------------------------------------------
  online?: boolean | null;
  lastSeen?: number | null;
  lastOnlineAt?: number | null;
  lastOfflineAt?: number | null;
  lastLocationAt?: number | null;
  lastStateChangeAt?: number | null;

  [key: string]: unknown;
}
