export const PUSH_NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;

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
 * Mantemos a mesma janela nas três plataformas para que a futura expansão
 * mobile não reintroduza o default de até quatro semanas do FCM.
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
        TTL: String(PUSH_NOTIFICATION_TTL_SECONDS),
      },
    },
  };
}
