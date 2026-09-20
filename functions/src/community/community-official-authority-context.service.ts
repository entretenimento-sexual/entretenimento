// functions/src/community/community-official-authority-context.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY OFFICIAL AUTHORITY CONTEXT
// -----------------------------------------------------------------------------
// Único adapter Firestore que reúne as fontes canônicas necessárias para
// Perfil/Organização/Local/Evento e entrega a decisão da policy de submissão.
//
// Este serviço NÃO concede autoridade:
// - ator vem do request.auth do caller;
// - role comunitária não participa;
// - assinatura pessoal não participa;
// - role/sponsor/evidências são sempre derivados das fontes backend-only.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import {
  buildEventAuthorityRecordId,
} from '../authority/event-authority.policy';
import { db } from '../firebaseApp';
import {
  buildOrganizationRepresentationId,
} from '../organization/organization-representation.policy';
import type {
  SubmitCommunityOfficialClaimIntentCommand,
} from './community-official-claim.model';
import {
  resolveCommunityOfficialClaimSubmission,
  type CommunityOfficialClaimSubmissionDecision,
} from './community-official-claim-submission.policy';

export async function resolveCommunityOfficialAuthorityContext(input: {
  readonly transaction: Transaction;
  readonly actorUid: string;
  readonly intent: SubmitCommunityOfficialClaimIntentCommand;
  readonly now: number;
}): Promise<Readonly<CommunityOfficialClaimSubmissionDecision>> {
  const { transaction, actorUid, intent, now } = input;

  const organizationRepresentationId =
    intent.target.type === 'organization'
      ? buildOrganizationRepresentationId(intent.target.id, actorUid)
      : null;
  const eventAuthorityId =
    intent.target.type === 'event'
      ? buildEventAuthorityRecordId(intent.target.id, actorUid)
      : null;

  const targetRef =
    intent.target.type === 'profile'
      ? db.collection('users').doc(actorUid)
      : intent.target.type === 'venue'
        ? db.collection('venues').doc(intent.target.id)
        : intent.target.type === 'organization'
          ? db.collection('organizations').doc(intent.target.id)
          : null;

  const targetSnapshot = targetRef
    ? await transaction.get(targetRef)
    : null;

  const profileKycSnapshot =
    intent.target.type === 'profile'
      ? await transaction.get(
        db.collection('profile_kyc_records').doc(actorUid)
      )
      : null;

  const grantSnapshot =
    intent.target.type === 'venue'
      ? await transaction.get(
        db.collection('official_space_creation_grants').doc(actorUid)
      )
      : null;

  const organizationKybSnapshot =
    intent.target.type === 'organization'
      ? await transaction.get(
        db.collection('organization_kyb_records').doc(intent.target.id)
      )
      : null;

  const organizationRepresentationSnapshot = organizationRepresentationId
    ? await transaction.get(
      db
        .collection('organization_representations')
        .doc(organizationRepresentationId)
    )
    : null;

  const eventAuthoritySnapshot = eventAuthorityId
    ? await transaction.get(
      db.collection('event_authority_records').doc(eventAuthorityId)
    )
    : null;

  return resolveCommunityOfficialClaimSubmission({
    actorUid,
    intent,
    rawGrant: grantSnapshot?.exists ? grantSnapshot.data() : null,
    rawTarget: targetSnapshot?.exists ? targetSnapshot.data() : null,
    rawProfileKyc: profileKycSnapshot?.exists
      ? profileKycSnapshot.data()
      : null,
    rawOrganizationKyb: organizationKybSnapshot?.exists
      ? organizationKybSnapshot.data()
      : null,
    rawOrganizationRepresentation: organizationRepresentationSnapshot?.exists
      ? organizationRepresentationSnapshot.data()
      : null,
    organizationRepresentationReferenceId: organizationRepresentationId,
    rawEventAuthority: eventAuthoritySnapshot?.exists
      ? eventAuthoritySnapshot.data()
      : null,
    eventAuthorityReferenceId: eventAuthorityId,
    now,
  });
}
