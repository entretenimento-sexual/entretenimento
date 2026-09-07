export type PushNotificationPreferenceKey =
  | 'messages'
  | 'connections'
  | 'rooms'
  | 'communities'
  | 'places'
  | 'compatibleStatus';

const OPTIONAL_PUSH_PREFERENCE_BY_TYPE = new Map<
  string,
  PushNotificationPreferenceKey
>([
  ['chat', 'messages'],
  ['social', 'connections'],
  ['community.comment.received', 'communities'],
  ['community.comment.reply.received', 'communities'],
  ['user_intent_status.compatible', 'compatibleStatus'],
]);

/**
 * Resolve a preferência que pode silenciar somente o push externo.
 * `null` significa notificação essencial ou tipo ainda não classificado.
 * Tipos desconhecidos permanecem essenciais até classificação explícita.
 */
export function resolvePushNotificationPreferenceKey(
  notificationType: unknown
): PushNotificationPreferenceKey | null {
  const normalizedType = String(notificationType ?? '').trim();
  return OPTIONAL_PUSH_PREFERENCE_BY_TYPE.get(normalizedType) ?? null;
}

/**
 * Preferências ausentes ou legadas seguem o mesmo default do cliente: ativas.
 * Apenas `false` explícito desativa a entrega push daquela categoria.
 */
export function isPushNotificationEnabledByPreference(
  preferenceKey: PushNotificationPreferenceKey,
  rawPreferences: unknown
): boolean {
  if (!isRecord(rawPreferences)) {
    return true;
  }

  return rawPreferences[preferenceKey] !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
