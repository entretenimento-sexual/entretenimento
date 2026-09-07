// src/app/core/services/notifications/notification-navigation.policy.ts
// -----------------------------------------------------------------------------
// NOTIFICATION NAVIGATION POLICY
// -----------------------------------------------------------------------------
// Contrato canônico de navegação das notificações no cliente Angular.
//
// Regras:
// - aceita somente rotas internas path-only iniciadas por "/";
// - rejeita URLs absolutas, protocol-relative, barras invertidas e controles;
// - normaliza path/query/hash via URL sem permitir troca de origin;
// - limita o tamanho para evitar propagar payloads de navegação anormais.
// -----------------------------------------------------------------------------

const NOTIFICATION_ROUTE_BASE_ORIGIN = 'https://notification-route.invalid';
const MAX_NOTIFICATION_ROUTE_LENGTH = 2048;

export function normalizeNotificationRoute(value: unknown): string | null {
  const route = String(value ?? '').trim();

  if (
    !route ||
    route.length > MAX_NOTIFICATION_ROUTE_LENGTH ||
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\') ||
    hasControlCharacters(route)
  ) {
    return null;
  }

  try {
    const resolved = new URL(route, NOTIFICATION_ROUTE_BASE_ORIGIN);

    if (resolved.origin !== NOTIFICATION_ROUTE_BASE_ORIGIN) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
