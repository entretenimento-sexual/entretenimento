// src/app/core/interfaces/venues/venue.interface.ts
// -----------------------------------------------------------------------------
// VENUES / ESTABELECIMENTOS
// -----------------------------------------------------------------------------
// Contrato-base para locais gerenciáveis da plataforma.
//
// Produto:
// - permite que Status de Hoje aponte para um estabelecimento real;
// - permite intenção temporária de sala privada associada ao local;
// - prepara uma futura sala oficial do estabelecimento em domínio próprio;
// - prepara patrocínio e destaque de estabelecimentos;
// - diferencia texto livre de local moderado/gerenciado.
//
// Segurança:
// - não armazena coordenada precisa nesta fase;
// - dados visíveis são moderados;
// - gestão do local não é liberada diretamente ao cliente comum;
// - ownerUid/adminUids existem para governança futura, mas a escrita inicial é admin;
// - configuração de chat não contém roomId: salas privadas podem ser múltiplas e
//   a futura sala oficial terá contrato, coleção e autorização próprios.
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

/**
 * Política do catálogo para associação temporária de salas privadas ao local.
 * Não representa uma sala oficial e não guarda identificador de sala.
 */
export interface IVenueChatConfig {
  enabled: boolean;
  mode: 'public_preview' | 'frequenters_only' | 'hybrid';
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
