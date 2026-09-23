// functions/src/community/community-owner-succession.policy.ts
// -----------------------------------------------------------------------------
// GUARDED COMMUNITY OWNER SUCCESSION
// -----------------------------------------------------------------------------
// Sucessão terminal não é transferência automática.
//
// Este contrato só se aplica quando o owner não pode mais resolver a propriedade
// por conta própria (conta definitivamente indisponível ou abandono confirmado).
// Suspensão, inatividade e downgrade continuam fora deste fluxo.
//
// Um sucessor:
// - precisa ter sido explicitamente designado pelo fluxo de resolução;
// - precisa manter membership ativo;
// - precisa estar elegível como conta;
// - precisa ter entitlement, quota e capacidade compatíveis;
// - precisa aceitar explicitamente;
// - nunca é escolhido por cargo, antiguidade, atividade ou "primeiro da fila".
//
// Se ninguém preencher o contrato dentro da janela de resolução, a Comunidade
// deve seguir para arquivamento seguro, preservando histórico/auditoria.
// -----------------------------------------------------------------------------

export type CommunityOwnerSuccessionTrigger =
  | 'owner_terminally_unavailable'
  | 'confirmed_abandonment';

export type CommunityOwnerSuccessionDecision =
  | Readonly<{
      state: 'awaiting_resolution';
      transferAllowed: false;
      archiveRequired: false;
      reason: 'successor_not_ready';
    }>
  | Readonly<{
      state: 'transfer_ready';
      transferAllowed: true;
      archiveRequired: false;
      reason: null;
    }>
  | Readonly<{
      state: 'archive_required';
      transferAllowed: false;
      archiveRequired: true;
      reason: 'succession_window_expired';
    }>;

export interface CommunityOwnerSuccessionCandidate {
  readonly explicitlyDesignated: boolean;
  readonly explicitlyAccepted: boolean;
  readonly membershipActive: boolean;
  readonly accountEligible: boolean;
  readonly ownershipEntitlementEligible: boolean;
  readonly ownershipQuotaAvailable: boolean;
  readonly ownershipCapacityCompatible: boolean;
}

export function evaluateCommunityOwnerSuccession(input: {
  readonly trigger: CommunityOwnerSuccessionTrigger;
  readonly candidate: Readonly<CommunityOwnerSuccessionCandidate> | null;
  readonly resolutionWindowExpired: boolean;
}): CommunityOwnerSuccessionDecision {
  const candidateReady = Boolean(
    input.candidate
    && input.candidate.explicitlyDesignated
    && input.candidate.explicitlyAccepted
    && input.candidate.membershipActive
    && input.candidate.accountEligible
    && input.candidate.ownershipEntitlementEligible
    && input.candidate.ownershipQuotaAvailable
    && input.candidate.ownershipCapacityCompatible
  );

  if (candidateReady) {
    return Object.freeze({
      state: 'transfer_ready',
      transferAllowed: true,
      archiveRequired: false,
      reason: null,
    });
  }

  if (input.resolutionWindowExpired) {
    return Object.freeze({
      state: 'archive_required',
      transferAllowed: false,
      archiveRequired: true,
      reason: 'succession_window_expired',
    });
  }

  return Object.freeze({
    state: 'awaiting_resolution',
    transferAllowed: false,
    archiveRequired: false,
    reason: 'successor_not_ready',
  });
}
