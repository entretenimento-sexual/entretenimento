// functions/src/notifications/push-notification-navigation.policy.ts
// Contrato server-side do deep link enviado ao Web Push.
// O backend nunca propaga uma URL arbitrária recebida do documento de
// notificação: somente uma rota interna path-only normalizada entra no FCM.

const PUSH_NOTIFICATION_ROUTE_BASE_ORIGIN =
  'https://notification-route.invalid';
const MAX_PUSH_NOTIFICATION_ROUTE_LENGTH = 2048;

export interface PushNotificationNavigationData
  extends Record<string, string> {
  route: string;
}

export function normalizePushNotificationRoute(
  value: unknown
): string | null {
  const route = String(value ?? '').trim();

  if (
    !route ||
    route.length > MAX_PUSH_NOTIFICATION_ROUTE_LENGTH ||
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\') ||
    hasControlCharacters(route)
  ) {
    return null;
  }

  try {
    const resolved = new URL(route, PUSH_NOTIFICATION_ROUTE_BASE_ORIGIN);

    if (resolved.origin !== PUSH_NOTIFICATION_ROUTE_BASE_ORIGIN) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

export function buildPushNotificationNavigationData(
  value: unknown
): PushNotificationNavigationData | null {
  const route = normalizePushNotificationRoute(value);
  return route ? {route} : null;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
