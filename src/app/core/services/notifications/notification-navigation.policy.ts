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
// - limita o tamanho para evitar propagar payloads de navegação anormais;
// - corrige somente o namespace legado de mensagens de Sala quando o próprio
//   documento comprova contexto de Sala por type=chat + roomId.
// -----------------------------------------------------------------------------

const NOTIFICATION_ROUTE_BASE_ORIGIN = 'https://notification-route.invalid';
const MAX_NOTIFICATION_ROUTE_LENGTH = 2048;
const CANONICAL_ROOMS_ROUTE = '/chat/rooms';
const LEGACY_ROOM_MESSAGES_ROUTE = '/messages';

export interface NotificationNavigationContext {
  type?: unknown;
  route?: unknown;
  roomId?: unknown;
}

export function resolveNotificationRoute(
  notification: NotificationNavigationContext
): string | null {
  const route = normalizeNotificationRoute(notification?.route);

  if (!route) {
    return null;
  }

  if (isLegacyRoomMessageNotification(notification, route)) {
    return CANONICAL_ROOMS_ROUTE;
  }

  return route;
}

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

function isLegacyRoomMessageNotification(
  notification: NotificationNavigationContext,
  normalizedRoute: string
): boolean {
  const type = String(notification?.type ?? '').trim();
  const roomId = String(notification?.roomId ?? '').trim();

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
