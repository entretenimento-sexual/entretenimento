// src/app/core/interfaces/notification-preferences.interface.ts
// -----------------------------------------------------------------------------
// NOTIFICATION PREFERENCES
// -----------------------------------------------------------------------------
// Preferências privadas do usuário para reduzir ruído e evitar spam.
// Conta/segurança não é desligável pela UI.
// -----------------------------------------------------------------------------

export interface INotificationPreferences {
  messages: boolean;
  connections: boolean;
  rooms: boolean;
  communities: boolean;
  places: boolean;
  compatibleStatus: boolean;
  accountSecurity: true;
}

export type NotificationPreferenceEditableKey =
  | 'messages'
  | 'connections'
  | 'rooms'
  | 'communities'
  | 'places'
  | 'compatibleStatus';

export interface INotificationPreferencesVm {
  loading: boolean;
  preferences: INotificationPreferences;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: INotificationPreferences = {
  messages: true,
  connections: true,
  rooms: true,
  communities: true,
  places: true,
  compatibleStatus: false,
  accountSecurity: true,
};
