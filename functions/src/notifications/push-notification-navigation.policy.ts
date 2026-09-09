// functions/src/notifications/push-notification-navigation.policy.ts
// Contrato server-side do deep link enviado ao Web Push.
// O backend nunca propaga uma URL arbitrária recebida do documento de
// notificação: somente uma rota interna path-only normalizada entra no FCM.
// A compatibilidade com mensagens legadas de Sala exige contexto explícito
// type=chat + roomId; /messages nunca é reescrito de forma global.

const PUSH_NOTIFICATION_ROUTE_BASE_ORIGIN =
  'https://notification-route.invalid';
const MAX_PUSH_NOTIFICATION_ROUTE_LENGTH = 2048;
const CANONICAL_ROOMS_ROUTE = '/chat/rooms';
const LEGACY_ROOM_MESSAGES_ROUTE = '/messages';

export interface PushNotificationNavigationData
  extends Record<string, string> {
  route: string;
}

export interface PushNotificationNavigationContext {
  type?: unknown;
  roomId?: unknown;
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
  value: unknown,
  context?: PushNotificationNavigationContext
): PushNotificationNavigationData | null {
  const route = normalizePushNotificationRoute(value);

  if (!route) {
    return null;
  }

  return {
    route: isLegacyRoomMessageNotification(context, route)
      ? CANONICAL_ROOMS_ROUTE
      : route,
  };
}

function isLegacyRoomMessageNotification(
  context: PushNotificationNavigationContext | undefined,
  normalizedRoute: string
): boolean {
  const type = String(context?.type ?? '').trim();
  const roomId = String(context?.roomId ?? '').trim();

  return (
    type === 'chat' &&
    roomId.length > 0 &&
    isLegacyRoomMessagesRoute(normalizedRoute)
  );
}

function isLegacyRoomMessagesRoute(route: string): boolean {
  return (
    route === LEGACY_ROOM_MESSAGES_ROUTE ||
    route.startsWith(`${LEGACY_ROOM_MESSAGES_ROUTE}/`) ||
    route.startsWith(`${LEGACY_ROOM_MESSAGES_ROUTE}?`) ||
    route.startsWith(`${LEGACY_ROOM_MESSAGES_ROUTE}#`)
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
