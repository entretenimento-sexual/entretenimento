// src/app/core/guards/access-guard/feature-flag.guard.ts
// -----------------------------------------------------------------------------
// FEATURE FLAG GUARD
// -----------------------------------------------------------------------------
// Impede o carregamento de experiências ainda não liberadas no ambiente atual.
// Feature flags controlam exposição e carregamento, nunca autorização de dados.
// -----------------------------------------------------------------------------

import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

import { environment } from 'src/environments/environment';
import type { FeaturesConfig } from 'src/environments/environment.model';

export type BooleanFeatureFlagName = {
  [Key in keyof FeaturesConfig]-?: Exclude<
    FeaturesConfig[Key],
    undefined
  > extends boolean
    ? Key
    : never;
}[keyof FeaturesConfig];

export function isFeatureEnabled(
  flag: BooleanFeatureFlagName,
  features: FeaturesConfig | undefined = environment.features
): boolean {
  return features?.[flag] === true;
}

export function requireFeatureFlag(
  flag: BooleanFeatureFlagName,
  features: FeaturesConfig | undefined = environment.features
): CanMatchFn {
  return () => {
    if (isFeatureEnabled(flag, features)) {
      return true;
    }

    return inject(Router).createUrlTree(['/dashboard/principal']);
  };
}
