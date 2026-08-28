// src/app/core/interfaces/interfaces-user-dados/iuser-preferences.ts

/**
 * @deprecated
 * Interface legado/V1.
 *
 * Motivo:
 * - ainda sustenta o editor atual de preferências baseado em flags soltas
 * - continua sendo usada pelo UserPreferencesService legado
 *
 * Destino:
 * - migrar gradualmente para:
 *   - IUserPreferenceProfile
 *   - IUserIntentState
 *   - IUserMatchProfile
 */
export interface IUserPreferences {
  [key: string]: any;
}