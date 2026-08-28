// functions/src/shared/runtime/functions-runtime.guard.ts
// -----------------------------------------------------------------------------
// FUNCTIONS RUNTIME GUARD
// -----------------------------------------------------------------------------
// Fonte única para detectar a execução real no Firebase Functions Emulator.
// Nunca confiar em parâmetros do cliente, NODE_ENV ou flags do frontend.
// -----------------------------------------------------------------------------

export function isFunctionsEmulatorRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}
