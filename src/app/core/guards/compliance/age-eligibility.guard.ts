import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { combineLatest } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';

import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';
import {
  isCurrentLegalAcceptanceSatisfied,
} from 'src/app/core/services/compliance/terms-acceptance.service';

export const ageEligibilityGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const ageEligibility = inject(AgeEligibilityService);
  const currentUser = inject(CurrentUserStoreService);
  const router = inject(Router);

  return combineLatest([
    currentUser.user$,
    ageEligibility.verifiedAdult$,
  ]).pipe(
    filter(([user]) => user !== undefined),
    take(1),
    map(([user, verifiedAdult]) => {
      if (!user) {
        return router.createUrlTree(['/login'], {
          queryParams: { redirectTo: state.url },
        });
      }

      // Sequência linear de compliance:
      // termos vigentes -> maioridade -> consentimento adulto.
      // Evita enviar o usuário a uma verificação que o backend recusaria
      // por termos ainda pendentes.
      if (!isCurrentLegalAcceptanceSatisfied(user.acceptedTerms)) {
        return router.createUrlTree(
          ['/register/aceitar-termos'],
          {
            queryParams: {
              reason: 'material_terms_update_required',
              redirectTo: state.url,
            },
          }
        );
      }

      if (verifiedAdult) {
        return true;
      }

      return router.createUrlTree(
        ['/adulto/verificar-idade'],
        {
          queryParams: {
            redirectTo: state.url,
          },
        }
      );
    })
  );
};
