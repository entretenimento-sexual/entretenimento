// functions/src/community/community-owner-continuity.policy.ts
// -----------------------------------------------------------------------------
// PERSONAL COMMUNITY OWNER CONTINUITY
// -----------------------------------------------------------------------------
// Contrato de continuidade para Comunidades de usuários.
//
// Ownership não é um benefício consumível que muda automaticamente com plano,
// suspensão ou inatividade. Também não é uma obrigação que possa ser imposta a
// outro participante sem aceite explícito.
//
// Consequências:
// - downgrade/lapse: owner permanece; capacidade/crescimento entram em
//   regularização pela policy de capacity;
// - suspensão temporária: owner permanece, mas sua autoridade operacional fica
//   bloqueada pelos gates de conta;
// - exclusão pendente: nenhuma herança automática; o recurso precisa ser
//   resolvido pelo fluxo de transferência/arquivo;
// - conta definitivamente removida ou abandono confirmado: abre-se sucessão
//   guardada, mas nunca se escolhe um herdeiro automaticamente;
// - mera inatividade não prova abandono.
// -----------------------------------------------------------------------------

export type CommunityOwnerAccountState =
  | 'active'
  | 'self_suspended'
  | 'moderation_suspended'
  | 'pending_deletion'
  | 'deleted'
  | 'unknown';

export type CommunityOwnerContinuityReason =
  | null
  | 'owner_plan_regularization_required'
  | 'owner_temporarily_unavailable'
  | 'owner_deletion_requires_resolution'
  | 'owner_terminally_unavailable'
  | 'confirmed_abandonment';

export interface CommunityOwnerContinuityDecision {
  readonly ownershipMode:
    | 'normal'
    | 'regularization'
    | 'temporarily_restricted'
    | 'resolution_required'
    | 'guarded_succession';
  readonly retainCanonicalOwnerPointer: boolean;
  readonly automaticInheritanceAllowed: false;
  readonly explicitSuccessorAcceptanceRequired: boolean;
  readonly reason: CommunityOwnerContinuityReason;
}

export function evaluateCommunityOwnerContinuity(input: {
  readonly ownerAccountState: CommunityOwnerAccountState;
  readonly planSupportsCurrentOwnership: boolean;
  readonly abandonmentConfirmed?: boolean;
}): Readonly<CommunityOwnerContinuityDecision> {
  if (input.abandonmentConfirmed === true) {
    return decision(
      'guarded_succession',
      false,
      true,
      'confirmed_abandonment'
    );
  }

  if (input.ownerAccountState === 'deleted') {
    return decision(
      'guarded_succession',
      false,
      true,
      'owner_terminally_unavailable'
    );
  }

  if (input.ownerAccountState === 'pending_deletion') {
    return decision(
      'resolution_required',
      true,
      true,
      'owner_deletion_requires_resolution'
    );
  }

  if (
    input.ownerAccountState === 'self_suspended'
    || input.ownerAccountState === 'moderation_suspended'
  ) {
    return decision(
      'temporarily_restricted',
      true,
      false,
      'owner_temporarily_unavailable'
    );
  }

  if (!input.planSupportsCurrentOwnership) {
    return decision(
      'regularization',
      true,
      false,
      'owner_plan_regularization_required'
    );
  }

  return decision('normal', true, false, null);
}

function decision(
  ownershipMode: CommunityOwnerContinuityDecision['ownershipMode'],
  retainCanonicalOwnerPointer: boolean,
  explicitSuccessorAcceptanceRequired: boolean,
  reason: CommunityOwnerContinuityReason
): Readonly<CommunityOwnerContinuityDecision> {
  return Object.freeze({
    ownershipMode,
    retainCanonicalOwnerPointer,
    automaticInheritanceAllowed: false,
    explicitSuccessorAcceptanceRequired,
    reason,
  });
}
