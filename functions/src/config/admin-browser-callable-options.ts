import { FUNCTIONS_REGION } from './functions-region';

/**
 * Contrato de transporte para callables administrativas acionadas pelo painel
 * Angular. App Check complementa as claims administrativas validadas pelos
 * handlers de domínio.
 *
 * Triggers, agendadores e executores internos não devem usar estas opções,
 * porque não representam tráfego originado do navegador.
 */
export const ADMIN_BROWSER_CALLABLE_OPTIONS = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
} as const;
