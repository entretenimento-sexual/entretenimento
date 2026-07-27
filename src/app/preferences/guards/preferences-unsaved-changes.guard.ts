// src/app/preferences/guards/preferences-unsaved-changes.guard.ts
// -----------------------------------------------------------------------------
// PROTEÇÃO DE ALTERAÇÕES NÃO SALVAS
// -----------------------------------------------------------------------------
// O guard não conhece formulários nem Firestore. Ele consulta apenas o contrato
// exposto pela página e usa a confirmação nativa do navegador, mantendo o fluxo
// leve, acessível e compatível com desktop e mobile.
// -----------------------------------------------------------------------------

import type { CanDeactivateFn } from '@angular/router';

export interface PreferencesUnsavedChangesAware {
  hasUnsavedChanges(): boolean;
}

const CONFIRMATION_MESSAGE =
  'Você tem alterações não salvas. Deseja sair sem salvar?';

export const preferencesUnsavedChangesGuard: CanDeactivateFn<
  PreferencesUnsavedChangesAware
> = (component) => {
  if (!component?.hasUnsavedChanges()) {
    return true;
  }

  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }

  return window.confirm(CONFIRMATION_MESSAGE);
};
