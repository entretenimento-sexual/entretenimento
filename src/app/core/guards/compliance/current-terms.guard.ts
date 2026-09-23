import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import {
  isCurrentLegalAcceptanceSatisfied,
} from 'src/app/core/services/compliance/terms-acceptance.service';
import { buildRedirectTree } from '../_shared-guard/guard-utils';

/**
 * Gate estreito para a primeira etapa da sequência de compliance.
 *
 * Ele não decide maioridade nem consentimento adulto. Apenas garante que os
 * Termos vigentes já estejam aceitos antes de abrir essas etapas, preservando
 * redirectTo para o usuário retomar o destino original.
 */
export const currentTermsGuard: CanActivateFn = (_route, state) => {
  const currentUser = inject(CurrentUserStoreService);
  const router = inject(Router);

  return currentUser.user$.pipe(
    filter((user) => user !== undefined),
    take(1),
    map((user) => {
      if (!user) {
        return buildRedirectTree(router, '/login', state.url);
      }

      if (isCurrentLegalAcceptanceSatisfied(user.acceptedTerms)) {
        return true;
      }

      return buildRedirectTree(
        router,
        '/register/aceitar-termos',
        state.url,
        { reason: 'material_terms_update_required' }
      );
    })
  );
};
