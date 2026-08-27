import type { CanActivateFn } from '@angular/router';

/**
 * Replacements exclusivos das configurações `*-discovery-visual`.
 *
 * Builds normais continuam usando os guards reais. O harness visual apenas
 * libera a navegação local até /dashboard/explorar sem autenticar conta real.
 */
export const authGuard: CanActivateFn = () => true;
export const accountLifecycleGuard: CanActivateFn = () => true;
export const adultContentConsentGuard: CanActivateFn = () => true;
export const ageReverificationGuard: CanActivateFn = () => true;
export const emailVerifiedGuard: CanActivateFn = () => true;
export const profileCompletedGuard: CanActivateFn = () => true;
