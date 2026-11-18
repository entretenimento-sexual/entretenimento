import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const legacyEmailVerificationReturnGuard: CanActivateFn = (route) => {
  if (route.queryParamMap.has('mode') || route.queryParamMap.has('oobCode')) {
    return true;
  }

  // Links antigos podem voltar do Firebase após o próprio provedor aplicar o código.
  return inject(Router).createUrlTree(['/register/welcome'], {
    queryParams: { autocheck: '1' },
  });
};
