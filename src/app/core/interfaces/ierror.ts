// src/app/core/interfaces/ierror.ts
export interface IError {
  message: string;
  code?: number;
  // opcionais, todos retrocompatíveis
  severity?: 'info' | 'warning' | 'error' | 'critical';
  context?: string;                        // componente/serviço
  cause?: unknown;                         // erro original
  extra?: Record<string, unknown>;         // metadados soltos (uid, rota, etc.)
  stack?: string;
  timestamp?: string;                      // ISO
}
