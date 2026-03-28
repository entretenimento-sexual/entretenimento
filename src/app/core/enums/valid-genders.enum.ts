// src\app\core\enums\valid-genders.enum.ts
/**
 * @deprecated
 * Enum legado usado principalmente em fluxos antigos de onboarding/welcome.
 *
 * Migração alvo:
 * - TGenderInterest
 * - TRelationshipIntent
 * - modelos em core/interfaces/preferences/*
 *
 * Não remover até migrar:
 * - WelcomeComponent
 * - qualquer formulário legado ainda baseado em enum fechado
 */
export enum ValidGenders {
  // Gêneros binários tradicionais
  HOMEM = 'homem',
  MULHER = 'mulher',

  // Casais
  CASAL_ELE_ELE = 'casal-ele-ele',
  CASAL_ELE_ELA = 'casal-ele-ela',
  CASAL_ELA_ELA = 'casal-ela-ela',

  // Gêneros trans e não binários
  TRANSEXUAL_HOMEM = 'transexual-homem',
  TRANSEXUAL_MULHER = 'transexual-mulher',
  TRAVESTI = 'travesti',
  NÃO_BINÁRIO = 'nao-binario',
  GÊNERO_FLUIDO = 'genero-fluido',
  AGÊNERO = 'agenero',
  BIGÊNERO = 'bigenero',
  DEMIGÊNERO = 'demigenero',
  PANGÊNERO = 'pangenero',

  // Expressões de gênero
  CROSSDRESSERS = 'crossdressers',
  ANDRÓGINO = 'androgino',
  NEUTROIS = 'neutrois',

  // Identidades culturais e tradicionais
  TWO_SPIRIT = 'two-spirit', // Termo usado por povos indígenas norte-americanos
  HIJRA = 'hijra', // Identidade cultural do sul da Ásia

  // Identidades intersexuais
  INTERSEXO = 'intersexo',

  // Gêneros queer
  GÊNERO_QUEER = 'genero-queer',

  // Identidades fluidas e híbridas
  FLUXO_DE_GÊNERO = 'fluxo-de-genero',

  // Identidades específicas
  HOMENS_TRANSMASCULINOS = 'homens-transmasculinos',
  MULHERES_TRANSFEMININAS = 'mulheres-transfemininas',
}
