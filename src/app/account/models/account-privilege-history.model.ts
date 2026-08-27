// src/app/account/models/account-privilege-history.model.ts
// Projeção sanitizada e read-only do histórico de privilégio administrativo
// da própria conta. Nenhum identificador interno é exposto ao frontend.

export type AccountPrivilegeHistoryEventType =
  | 'admin_granted'
  | 'admin_revoked';

export interface AccountPrivilegeHistoryItem {
  id: string;
  eventType: AccountPrivilegeHistoryEventType;
  occurredAt: number;
}

export interface AccountPrivilegeHistoryPage {
  items: AccountPrivilegeHistoryItem[];
  nextCursor: string | null;
}
