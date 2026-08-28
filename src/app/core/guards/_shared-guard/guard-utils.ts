// src/app/core/guards/_shared-guard/guard-utils.ts
// Utilitários compartilhados para guards.
//
// Objetivo:
// - padronizar logs de guards
// - padronizar construção de UrlTree com redirectTo
// - evitar duplicação de lógica e mensagens espalhadas
// - centralizar o critério de "estado resolvido" para evitar race conditions
import { Router, UrlTree } from '@angular/router';

declare global {
  interface Window {
    __DBG_ON__?: boolean;
  }
}

/**
 * Debug de guards:
 * - fica desligado por padrão
 * - acompanha o mecanismo já existente no main.ts
 */
export const GUARDS_DEBUG =
  typeof window !== 'undefined' && window.__DBG_ON__ === true;

export function guardLog(tag: string, ...args: unknown[]): void {
  if (!GUARDS_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(`[Guard:${tag}]`, ...args);
}

/**
 * Constrói uma UrlTree preservando o redirectTo quando necessário.
 */
export function buildRedirectTree(
  router: Router,
  target: string,
  stateUrl?: string,
  extras?: Record<string, unknown>
): UrlTree {
  const queryParams: Record<string, unknown> = { ...(extras ?? {}) };

  if (stateUrl) {
    queryParams['redirectTo'] = stateUrl;
  }

  return router.createUrlTree([target], { queryParams });
}

/**
 * Helper específico para a etapa de verificação de e-mail.
 */
export function buildWelcomeRedirectTree(
  router: Router,
  stateUrl?: string,
  extras?: Record<string, unknown>
): UrlTree {
  return buildRedirectTree(router, '/register/welcome', stateUrl, {
    autocheck: 1,
    ...(extras ?? {}),
  });
}

/**
 * Helper específico para a etapa de finalização de cadastro.
 */
export function buildFinalizeRedirectTree(
  router: Router,
  stateUrl?: string,
  extras?: Record<string, unknown>
): UrlTree {
  return buildRedirectTree(router, '/register/finalizar-cadastro', stateUrl, {
    ...(extras ?? {}),
  });
}

/**
 * Define quando o estado de acesso já está resolvido o suficiente
 * para um guard tomar decisão sem cair em race condition.
 *
 * Regra:
 * - se NÃO há uid autenticado -> já está resolvido
 * - se HÁ uid -> esperamos appUser sair de undefined
 *
 * Observação:
 * - undefined = hidratação ainda em andamento
 * - null = resolvido, mas sem documento/perfil carregado
 * - objeto = resolvido com perfil
 */
export function isResolvedAccessState(
  authUid: string | null | undefined,
  appUser: unknown
): boolean {
  if (!authUid) {
    return true;
  }

  return appUser !== undefined;
}
