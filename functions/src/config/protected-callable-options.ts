import { FUNCTIONS_REGION } from './functions-region';

/**
 * App Check é obrigatório nas callables protegidas quando executadas na nuvem.
 *
 * O Emulator Suite não emite App Check real e precisa permanecer utilizável
 * para validação local. A exceção é limitada ao processo oficial do emulator.
 */
export const PROTECTED_CALLABLE_OPTIONS = {
  region: FUNCTIONS_REGION,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
} as const;
