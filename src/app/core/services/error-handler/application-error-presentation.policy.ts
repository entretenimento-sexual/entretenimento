// src/app/core/services/error-handler/application-error-presentation.policy.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR PRESENTATION POLICY
// -----------------------------------------------------------------------------
// Política pura e canônica para sanitizar apresentações e ações de erro.
// Nenhum renderer (MatDialog/MatSnackBar) deve reinterpretar rotas ou payloads.
// -----------------------------------------------------------------------------

import {
  DEFAULT_APPLICATION_ERROR_PRESENTATION,
  type ApplicationErrorPresentation,
  type ApplicationErrorSeverity,
  type ApplicationErrorSurface,
} from './application-error-presentation.model';

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeSurface(value: unknown): ApplicationErrorSurface {
  return value === 'modal'
    || value === 'inline'
    || value === 'page'
    || value === 'none'
    || value === 'snackbar'
    ? value
    : DEFAULT_APPLICATION_ERROR_PRESENTATION.surface;
}

function normalizeSeverity(value: unknown): ApplicationErrorSeverity {
  return value === 'warning' || value === 'info' || value === 'error'
    ? value
    : DEFAULT_APPLICATION_ERROR_PRESENTATION.severity;
}

/**
 * Aceita somente navegação interna Angular.
 *
 * Rejeitamos protocol-relative URLs, barras invertidas e caracteres de controle
 * para que a camada visual não precise repetir validações de segurança.
 */
export function normalizeApplicationErrorInternalRoute(
  value: unknown
): string | null {
  const route = safeString(value, 300);

  if (
    !route
    || !route.startsWith('/')
    || route.startsWith('//')
    || route.includes('\\')
    || CONTROL_CHARACTERS.test(route)
  ) {
    return null;
  }

  return route;
}

export function normalizeApplicationErrorPresentation(
  raw: Readonly<ApplicationErrorPresentation> | null | undefined
): ApplicationErrorPresentation {
  const source = raw ?? DEFAULT_APPLICATION_ERROR_PRESENTATION;
  const actionLabel = safeString(source.primaryAction?.label, 80);
  const actionRoute = normalizeApplicationErrorInternalRoute(
    source.primaryAction?.route
  );
  const title = safeString(source.title, 100);
  const detail = safeString(source.detail, 360);
  const dismissLabel = safeString(source.dismissLabel, 80);

  return {
    surface: normalizeSurface(source.surface),
    severity: normalizeSeverity(source.severity),
    ...(title ? { title } : {}),
    ...(detail ? { detail } : {}),
    ...(actionLabel
      ? {
          primaryAction: {
            label: actionLabel,
            ...(actionRoute ? { route: actionRoute } : {}),
          },
        }
      : {}),
    ...(dismissLabel ? { dismissLabel } : {}),
  };
}
