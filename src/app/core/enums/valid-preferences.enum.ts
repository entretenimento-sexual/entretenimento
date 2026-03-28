// src\app\core\enums\valid-preferences.enum.ts
/**
 * @deprecated
 * Enum legado usado em fluxos antigos de onboarding/welcome.
 *
 * Migração alvo:
 * - TPractice
 * - TRelationshipIntent
 * - IUserPreferenceProfile / IUserIntentState
 *
 * Não remover até migrar consumidores legados.
 */
export enum ValidPreferences {
  SWING = 'swing',
  MENAGE = 'menage',
  SAMESEX = 'sameSex',
  EXHIBITION = 'exhibition',
  PROFESSIONALS = 'professionals',
  BDSM = 'bdsm',
  ROLEPLAY = 'roleplay',
  VOYEURISM = 'voyeurism',
  FETISH = 'fetish',
  POLYAMORY = 'polyamory',
  TRANSSEXUAL = 'transsexual',
  CROSSDRESSER = 'crossdresser',
  TRAVESTI = 'travesti'
}
