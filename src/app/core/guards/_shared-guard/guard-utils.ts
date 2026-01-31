//src\app\core\guards\_shared-guard\guard-utils.ts
// Utilitários compartilhados para guards
// Não esquecer os comentários explicativos
import { UrlTree, Router } from '@angular/router';

export const GUARDS_DEBUG = true;

export function guardLog(tag: string, ...args: unknown[]): void {
  if (GUARDS_DEBUG) console.log(`[Guard:${tag}]`, ...args);
}

export function buildRedirectTree(
  router: Router,
  target: string,
  stateUrl?: string,
  extras?: Record<string, any>
): UrlTree {
  const queryParams: Record<string, any> = { ...(extras ?? {}) };

  if (stateUrl) queryParams['redirectTo'] = stateUrl;

  return router.createUrlTree([target], { queryParams });
}
