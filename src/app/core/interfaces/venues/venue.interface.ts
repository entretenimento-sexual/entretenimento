// src/app/core/interfaces/venues/venue.interface.ts
// -----------------------------------------------------------------------------
// VENUES / ESTABELECIMENTOS
// -----------------------------------------------------------------------------
// Contrato-base para locais gerenciáveis da plataforma.
//
// Produto:
// - permite que Status de Hoje aponte para um estabelecimento real;
// - prepara salas de bate-papo por local;
// - prepara patrocínio e destaque de estabelecimentos;
// - diferencia texto livre de local moderado/gerenciado.
//
// Segurança:
// - não armazena coordenada precisa nesta primeira fase;
// - dados visíveis são moderados;
// - gestão do local não é liberada diretamente ao cliente comum;
// - ownerUid/adminUids existem para governança futura, mas a escrita inicial é admin.
// -----------------------------------------------------------------------------

export type VenueKind =
  | 'bar'
  | 'club'
  | 'restaurant'
  | 'pub'
  | 'event_space'
  | 'hotel'
  | 'other';

export type VenueVisibility = 'public' | 'members_only' | 'hidden';

export type VenueModerationState =
  | 'active'
  | 'pending_review'
  | 'hidden'
  | 'rejected';

export type VenueSponsorshipState =
  | 'none'
  | 'eligible'
  | 'sponsored'
  | 'paused';

export interface IVenueRegion {
  uf: string;
  city: string;
  district?: string | null;
}

export interface IVenueModeration {
  state: VenueModerationState;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  reason?: string | null;
}

export interface IVenueSponsorship {
  state: VenueSponsorshipState;
  priority?: number | null;
  startsAt?: number | null;
  endsAt?: number | null;
}

export interface IVenueChatConfig {
  enabled: boolean;
  mode: 'public_preview' | 'frequenters_only' | 'hybrid';
  roomId?: string | null;
}

export interface IVenue {
  id: string;
  name: string;
  slug: string;
  kind: VenueKind;
  description?: string | null;
  region: IVenueRegion;
  addressHint?: string | null;
  visibility: VenueVisibility;
  moderation: IVenueModeration;
  sponsorship: IVenueSponsorship;
  chat: IVenueChatConfig;
  ownerUid?: string | null;
  adminUids?: string[];
  createdAt?: number | null;
  updatedAt?: number | null;
}

export interface IVenueCardVm extends IVenue {
  regionLabel: string;
  kindLabel: string;
  sponsorshipLabel: string | null;
  canShowChatEntry: boolean;
}

export interface IVenueQueryOptions {
  limit?: number;
  kind?: VenueKind | 'any';
  includeSponsoredFirst?: boolean;
}
