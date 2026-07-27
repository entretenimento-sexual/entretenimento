// src/app/core/interfaces/preferences/user-discovery-preferences.interface.ts
// -----------------------------------------------------------------------------
// PROJEÇÃO PRIVADA DAS PREFERÊNCIAS DE DISCOVERY DO USUÁRIO
// -----------------------------------------------------------------------------
// Este contrato vive em core porque é consumido pelo domínio de preferências,
// pelo NgRx e pelas telas de discovery. Ele não representa assinatura nem dados
// financeiros e nunca deve ser usado como fonte de entitlement.
// -----------------------------------------------------------------------------

export type UserDiscoveryMatchMode = 'prefer' | 'require';

export type UserDiscoveryRelationshipIntent =
  | 'friendship'
  | 'casual'
  | 'dating'
  | 'serious'
  | 'open_relationship'
  | 'polyamory'
  | 'swing'
  | 'fetish_exploration';

export type UserDiscoveryGenderInterest =
  | 'men'
  | 'women'
  | 'couple_mm'
  | 'couple_mf'
  | 'couple_ff'
  | 'travestis'
  | 'trans_people'
  | 'crossdressers'
  | 'non_binary'
  | 'intersex'
  | 'drag_queen'
  | 'drag_king'
  | 'genderfluid'
  | 'agender'
  | 'genderqueer'
  | 'androgynous';

export interface IUserDiscoveryAgeRange {
  min: number;
  max: number;
}

export interface IUserDiscoveryPreferences {
  /** Seleções explícitas feitas no editor. Array vazio significa sem filtro explícito. */
  genderInterests: readonly UserDiscoveryGenderInterest[];
  relationshipIntents: readonly UserDiscoveryRelationshipIntent[];

  acceptsCouples: boolean;
  acceptsSingles: boolean;

  /** null = sem restrição; true = aceita; false = não exibir perfis trans. */
  acceptsTransProfiles: boolean | null;

  ageRange: IUserDiscoveryAgeRange | null;
  maxDistanceKm: number | null;
  locationRequired: boolean;

  relationshipIntentMode: UserDiscoveryMatchMode;
  sexualPractices: readonly string[];
  sexualPracticeMode: UserDiscoveryMatchMode;
  bodyPreferences: readonly string[];
  bodyPreferenceMode: UserDiscoveryMatchMode;

  /** Epoch em milissegundos para debug/sincronização, sem uso em autorização. */
  updatedAt: number;
}
