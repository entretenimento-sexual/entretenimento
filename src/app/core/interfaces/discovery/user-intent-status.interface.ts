// src/app/core/interfaces/discovery/user-intent-status.interface.ts
// -----------------------------------------------------------------------------
// USER INTENT STATUS / STATUS DE HOJE
// -----------------------------------------------------------------------------
// Status temporário de disponibilidade/intenção do usuário.
//
// Produto:
// - funciona como um status temporário, inspirado no comportamento de stories;
// - usuário informa disponibilidade, intenção e possível destino/região;
// - expira por padrão em até 12 horas;
// - aparece em Descobertas com dados públicos mínimos do perfil;
// - futuramente pode alimentar salas de locais e vitrines patrocinadas.
//
// Segurança:
// - não armazena coordenada precisa;
// - não armazena endereço privado;
// - não deve carregar texto livre sem moderação quando for exibido amplamente;
// - snapshots públicos são limitados para evitar joins caros e vazamento de perfil.
// -----------------------------------------------------------------------------

export type UserIntentStatusState =
  | 'active'
  | 'expired'
  | 'hidden'
  | 'moderation_hold';

export type UserIntentAvailability =
  | 'available_now'
  | 'available_today'
  | 'planning_later';

export type UserIntentVisibility =
  | 'public_discovery'
  | 'members_only'
  | 'friends_only';

export type UserIntentDestinationKind =
  | 'region'
  | 'venue'
  | 'event'
  | 'undecided';

export interface IUserIntentStatusRegion {
  uf: string;
  city: string;
}

export interface IUserIntentStatusPublicProfile {
  uid: string;
  nickname: string;
  photoURL?: string | null;
  age?: number | null;
}

export interface IUserIntentStatusDestination {
  kind: UserIntentDestinationKind;
  label: string;
  venueId?: string | null;
  region: IUserIntentStatusRegion;
}

export interface IUserIntentStatusModeration {
  state: UserIntentStatusState;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  reason?: string | null;
}

export interface IUserIntentStatus {
  id: string;
  uid: string;
  profile: IUserIntentStatusPublicProfile;
  availability: UserIntentAvailability;
  visibility: UserIntentVisibility;
  destination: IUserIntentStatusDestination;
  moderation: IUserIntentStatusModeration;
  startsAt: number;
  expiresAt: number;
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface IUserIntentStatusPublishInput {
  uid: string;
  profile: IUserIntentStatusPublicProfile;
  availability: UserIntentAvailability;
  visibility: UserIntentVisibility;
  destination: IUserIntentStatusDestination;
  startsAt?: number | null;
  durationHours?: number | null;
}

export interface IUserIntentStatusCardVm extends IUserIntentStatus {
  destinationLabel: string;
  availabilityLabel: string;
  expiresInLabel: string;
  isActive: boolean;
}

export interface IUserIntentStatusQueryOptions {
  limit?: number;
  includeVenueId?: string | null;
}
