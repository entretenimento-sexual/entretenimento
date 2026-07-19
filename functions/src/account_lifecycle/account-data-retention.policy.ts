// functions/src/account_lifecycle/account-data-retention.policy.ts
// -----------------------------------------------------------------------------
// ACCOUNT DATA RETENTION POLICY
// -----------------------------------------------------------------------------
// Matriz canônica para exclusão, anonimização, desvinculação e retenção.
//
// Princípios:
// - nenhuma varredura genérica ou recursiveDelete indiscriminado;
// - mensagens e conteúdo compartilhado são anonimizados, não apagados às cegas;
// - denúncias, auditoria e registros financeiros possuem retenção controlada;
// - o documento privado users/{uid} só pode ser removido quando todos os passos
//   pre_finalize que bloqueiam a finalização estiverem concluídos;
// - a política é serializável e registrada no tombstone para auditoria/retry.
// -----------------------------------------------------------------------------

export const ACCOUNT_DATA_RETENTION_POLICY_VERSION = 2;

export type AccountDataDomain =
  | 'public_profile'
  | 'nickname_index'
  | 'auth_identity'
  | 'notifications'
  | 'preferences'
  | 'presence_and_location'
  | 'relationship_edges'
  | 'friend_requests'
  | 'community_memberships'
  | 'room_participation'
  | 'owned_media_and_storage'
  | 'shared_messages'
  | 'shared_publications'
  | 'moderation_reports_and_evidence'
  | 'financial_records_and_entitlements'
  | 'private_user_document'
  | 'lifecycle_and_security_audit';

export type AccountDataDisposition =
  | 'delete'
  | 'anonymize'
  | 'unlink'
  | 'retain';

export type AccountDataPolicyPhase =
  | 'pre_finalize'
  | 'finalize'
  | 'post_finalize';

export type AccountDataAutomationStatus =
  | 'implemented'
  | 'contract_required'
  | 'manual_review';

export type AccountDataPlanStepStatus =
  | 'completed'
  | 'pending'
  | 'blocked';

export interface AccountDataRetentionPolicyEntry {
  domain: AccountDataDomain;
  disposition: AccountDataDisposition;
  phase: AccountDataPolicyPhase;
  automation: AccountDataAutomationStatus;
  blocksFinalization: boolean;
  reason: string;
  retentionDays?: number | null;
}

export interface AccountDataDeletionPlanStep {
  domain: AccountDataDomain;
  disposition: AccountDataDisposition;
  phase: AccountDataPolicyPhase;
  automation: AccountDataAutomationStatus;
  status: AccountDataPlanStepStatus;
  blocksFinalization: boolean;
  retentionDays: number | null;
}

export interface AccountDataDeletionPlan {
  policyVersion: number;
  uid: string;
  generatedAt: number;
  status: 'ready' | 'blocked';
  completedDomains: AccountDataDomain[];
  blockingDomains: AccountDataDomain[];
  steps: AccountDataDeletionPlanStep[];
}

export const ACCOUNT_DATA_RETENTION_POLICY: readonly AccountDataRetentionPolicyEntry[] = [
  {
    domain: 'public_profile',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'A projeção pública deve desaparecer no início irreversível do expurgo.',
  },
  {
    domain: 'nickname_index',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'A reserva pública do apelido não deve sobreviver à exclusão definitiva.',
  },
  {
    domain: 'auth_identity',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'A credencial deve ser removida antes do documento privado.',
  },
  {
    domain: 'notifications',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'Notificações privadas são removidas por executor paginado e idempotente.',
  },
  {
    domain: 'preferences',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'Preferências privadas são removidas diretamente pelo executor do lifecycle.',
  },
  {
    domain: 'presence_and_location',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Presença, localização e check-ins são dados sensíveis e temporários.',
  },
  {
    domain: 'relationship_edges',
    disposition: 'unlink',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Amizades já são desvinculadas; bloqueios e seus eventos ainda exigem contrato de retenção de segurança.',
  },
  {
    domain: 'friend_requests',
    disposition: 'unlink',
    phase: 'pre_finalize',
    automation: 'implemented',
    blocksFinalization: true,
    reason: 'Solicitações recebidas e enviadas são removidas por consultas paginadas e idempotentes.',
  },
  {
    domain: 'community_memberships',
    disposition: 'unlink',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Memberships, papéis e índices privados precisam ser removidos de forma coordenada.',
  },
  {
    domain: 'room_participation',
    disposition: 'unlink',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Participações, convites e papéis em Salas não podem manter acesso residual.',
  },
  {
    domain: 'owned_media_and_storage',
    disposition: 'delete',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Metadados e objetos privados de mídia devem ser apagados; evidências seguem política própria.',
  },
  {
    domain: 'shared_messages',
    disposition: 'anonymize',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Mensagens compartilhadas não devem ser apagadas sem preservar contexto dos demais participantes.',
  },
  {
    domain: 'shared_publications',
    disposition: 'anonymize',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    reason: 'Publicações, comentários e reações exigem política por audiência, moderação e autoria.',
  },
  {
    domain: 'moderation_reports_and_evidence',
    disposition: 'retain',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    retentionDays: null,
    reason: 'Denúncias e evidências precisam de pseudonimização e retenção definida por segurança e obrigação legal.',
  },
  {
    domain: 'financial_records_and_entitlements',
    disposition: 'retain',
    phase: 'pre_finalize',
    automation: 'contract_required',
    blocksFinalization: true,
    retentionDays: null,
    reason: 'Registros financeiros exigem cancelamento, conciliação, retenção legal e pseudonimização.',
  },
  {
    domain: 'private_user_document',
    disposition: 'delete',
    phase: 'finalize',
    automation: 'implemented',
    blocksFinalization: false,
    reason: 'É o último documento operacional removido depois de todos os passos obrigatórios.',
  },
  {
    domain: 'lifecycle_and_security_audit',
    disposition: 'retain',
    phase: 'post_finalize',
    automation: 'implemented',
    blocksFinalization: false,
    retentionDays: null,
    reason: 'Tombstone e auditoria mínima permanecem pseudonimizados para segurança e idempotência.',
  },
] as const;

export function buildAccountDataDeletionPlan(input: {
  uid: string;
  generatedAt: number;
  completedDomains?: readonly AccountDataDomain[];
  policy?: readonly AccountDataRetentionPolicyEntry[];
}): AccountDataDeletionPlan {
  const uid = String(input.uid ?? '').trim();
  const generatedAt = normalizeEpoch(input.generatedAt);
  const policy = input.policy ?? ACCOUNT_DATA_RETENTION_POLICY;
  const completedSet = new Set(input.completedDomains ?? []);

  const steps = policy.map<AccountDataDeletionPlanStep>((entry) => {
    const completed = completedSet.has(entry.domain);
    const blocked =
      !completed &&
      entry.phase === 'pre_finalize' &&
      entry.blocksFinalization &&
      entry.automation !== 'implemented';

    return {
      domain: entry.domain,
      disposition: entry.disposition,
      phase: entry.phase,
      automation: entry.automation,
      status: completed ? 'completed' : blocked ? 'blocked' : 'pending',
      blocksFinalization: entry.blocksFinalization,
      retentionDays: normalizeRetentionDays(entry.retentionDays),
    };
  });

  const blockingDomains = steps
    .filter(
      (step) =>
        step.phase === 'pre_finalize' &&
        step.blocksFinalization &&
        step.status !== 'completed'
    )
    .map((step) => step.domain);

  return {
    policyVersion: ACCOUNT_DATA_RETENTION_POLICY_VERSION,
    uid,
    generatedAt,
    status: blockingDomains.length === 0 ? 'ready' : 'blocked',
    completedDomains: steps
      .filter((step) => step.status === 'completed')
      .map((step) => step.domain),
    blockingDomains,
    steps,
  };
}

export function canFinalizePrivateUserDeletion(
  plan: AccountDataDeletionPlan
): boolean {
  return plan.status === 'ready' && plan.blockingDomains.length === 0;
}

function normalizeEpoch(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : Date.now();
}

function normalizeRetentionDays(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.trunc(parsed)
    : null;
}
