// src/app/core/interfaces/preferences/user-preference-enums.ts
// Não esquecer comentários explicativos e cosiderar sempre o role do usuário
export type TDiscoveryMode = 'normal' | 'discreet' | 'priority';

export type TCurrentIntentMode =
  | 'chat'
  | 'meet_today'
  | 'casual'
  | 'dating'
  | 'serious'
  | 'fetish'
  | 'travel'
  | 'discreet'
  | 'inactive';

export type TRelationshipIntent =
  | 'friendship'
  | 'casual'
  | 'serious'
  | 'dating'
  | 'swing'
  | 'fetish_exploration';

export type TBodyType =
  | 'magro'
  | 'sarado'
  | 'gordinho'
  | 'alto'
  | 'baixo'
  | 'tatuado';

export type TPractice =
  | 'sexo_baunilha'
  | 'bdsm'
  | 'swing'
  | 'menage'
  | 'exibicionismo'
  | 'voyeurismo'
  | 'fetiches';

export type TGenderInterest =
  | 'homens'
  | 'mulheres'
  | 'casais_ele_ele'
  | 'casais_ele_ela'
  | 'casais_ela_ela'
  | 'travestis'
  | 'transexuais'
  | 'crossdressers'
  | 'nao_binario'
  | 'intersexo'
  | 'drag_queen'
  | 'drag_king';