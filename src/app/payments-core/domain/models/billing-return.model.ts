// src/app/payments-core/domain/models/billing-return.model.ts
// -----------------------------------------------------------------------------
// BILLING RETURN MODELS
// -----------------------------------------------------------------------------
//
// Contratos do retorno visual de billing no frontend.
//
// Regra central:
// - a URL de retorno não confirma pagamento;
// - o frontend informa apenas o sinal visual recebido e o identificador da
//   sessão criada anteriormente pelo backend;
// - confirmação de acesso vem do backend, baseada em entitlement válido.
//
// Campos removidos:
// - mockProvider;
// - providerSessionId.
//
// Motivo:
// - provider e sessão externa são detalhes internos do backend;
// - parâmetros vindos do navegador não devem participar da decisão financeira.
export type BillingReturnStatus =
  | 'idle'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'canceled'
  | 'login_required';

export type BillingGrantedRole = 'basic' | 'premium' | 'vip';

export interface BillingReturnQuery {
  billing: string | null;
  scope: string | null;
  checkoutSessionId: string | null;
}

export interface ProcessBillingReturnInput {
  billing: string;
  scope: string;
  checkoutSessionId: string;
}

export interface ProcessBillingReturnResult {
  status: 'processing' | 'granted' | 'failed' | 'canceled';
  scope: string;
  role?: BillingGrantedRole | null;
  accessGranted?: boolean;
  checkoutSessionId?: string | null;
  redirectTo?: string | null;
  message?: string | null;
}

export interface BillingSnapshotResult {
  role?: BillingGrantedRole | null;
  tier?: BillingGrantedRole | null;
  isSubscriber?: boolean;
  entitlements?: string[];
  updatedAt?: number | null;
}

export interface BillingReturnVm {
  status: BillingReturnStatus;
  title: string;
  description: string;
  detail?: string | null;
  busy: boolean;
  primaryActionLabel?: string | null;
  secondaryActionLabel?: string | null;
}