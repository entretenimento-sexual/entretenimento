import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { map, take } from 'rxjs/operators';

import {
  AgeEligibilityService,
} from 'src/app/core/services/compliance/age-eligibility.service';

export const ageEligibilityGuard: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
) => {
  const ageEligibility = inject(AgeEligibilityService);
  const router = inject(Router);

  return ageEligibility.verifiedAdult$.pipe(
    take(1),
    map((verifiedAdult) => {
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
