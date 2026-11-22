export const PUSH_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type NotificationPushMode = 'ESSENTIAL' | 'IN_APP_ONLY';

export function shouldAttemptExternalPush(
  value: unknown
): boolean {
  return String(value ?? 'ESSENTIAL').trim().toUpperCase() !== 'IN_APP_ONLY';
}

export interface PushNotificationDeliveryOptions {
  android: {
    ttl: number;
  };
  apns: {
    headers: {
      'apns-expiration': string;
    };
  };
  webpush: {
    headers: {
      TTL: string;
    };
  };
}

/**
 * A Central in-app é a fonte durável da notificação. O push externo é apenas
 * um alerta e não deve reaparecer semanas depois de ter sido criado.
 *
 * Na Web a entrega é imediata. A fila do provedor não deve reapresentar
 * alertas de uma sessão antiga quando o navegador voltar a ficar online.
 */
export function buildPushNotificationDeliveryOptions(
  nowMs = Date.now()
): PushNotificationDeliveryOptions {
  const expirationSeconds =
    Math.floor(nowMs / 1000) + PUSH_NOTIFICATION_TTL_SECONDS;

  return {
    android: {
      ttl: PUSH_NOTIFICATION_TTL_SECONDS * 1000,
    },
    apns: {
      headers: {
        'apns-expiration': String(expirationSeconds),
      },
    },
    webpush: {
      headers: {
        TTL: '0',
      },
    },
  };
}
