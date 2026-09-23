// functions/src/community/community-owner-terminal-succession.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY OWNER TERMINAL SUCCESSION SERVICE
// -----------------------------------------------------------------------------
// Abre casos terminais para Comunidades ainda possuídas por uma conta cuja
// identidade já chegou ao ponto de purge. Não escolhe candidato e não transfere
// ownership. O prazo começa aqui; o scheduler arquiva se não houver sucessor.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS,
  COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION,
  type CommunityOwnerTerminalSuccessionTrigger,
} from './community-ownership-transfer.workflow.policy';

const CASE_COLLECTION = 'community_owner_succession_cases';
const MAX_AUTO_TERMINAL_SUCCESSION_COMMUNITIES = 20;

export interface EnsureTerminalSuccessionCasesResult {
  readonly ownedCommunityCount: number;
  readonly openedCaseCount: number;
  readonly existingOpenCaseCount: number;
  readonly inconsistentCaseCount: number;
  readonly exceedsAutomaticLimit: boolean;
  readonly communityIds: readonly string[];
}

export async function ensureCommunityOwnerTerminalSuccessionCasesInTransaction(
  transaction: Transaction,
  input: {
    readonly ownerUid: string;
    readonly trigger: CommunityOwnerTerminalSuccessionTrigger;
    readonly actorUid: string;
    readonly now: number;
  }
): Promise<Readonly<EnsureTerminalSuccessionCasesResult>> {
  const ownerUid = String(input.ownerUid ?? '').trim();
  if (!ownerUid) {
    return Object.freeze({
      ownedCommunityCount: 0,
      openedCaseCount: 0,
      existingOpenCaseCount: 0,
      inconsistentCaseCount: 0,
      exceedsAutomaticLimit: false,
      communityIds: Object.freeze([]),
    });
  }

  const ownedCommunitiesQuery = db
    .collection('communities')
    .where('ownerUid', '==', ownerUid)
    .where('source.type', '==', 'community')
    .where('status', 'in', ['active', 'paused', 'dormant'])
    .limit(MAX_AUTO_TERMINAL_SUCCESSION_COMMUNITIES + 1);
  const ownedCommunitiesSnapshot = await transaction.get(
    ownedCommunitiesQuery
  );
  const exceedsAutomaticLimit =
    ownedCommunitiesSnapshot.size > MAX_AUTO_TERMINAL_SUCCESSION_COMMUNITIES;
  const communityDocuments = exceedsAutomaticLimit
    ? ownedCommunitiesSnapshot.docs.slice(
      0,
      MAX_AUTO_TERMINAL_SUCCESSION_COMMUNITIES
    )
    : ownedCommunitiesSnapshot.docs;

  if (exceedsAutomaticLimit) {
    return Object.freeze({
      ownedCommunityCount: ownedCommunitiesSnapshot.size,
      openedCaseCount: 0,
      existingOpenCaseCount: 0,
      inconsistentCaseCount: 0,
      exceedsAutomaticLimit: true,
      communityIds: Object.freeze(
        communityDocuments.map((document) => document.id)
      ),
    });
  }

  const caseEntries = [];
  for (const communityDocument of communityDocuments) {
    const caseRef = db.collection(CASE_COLLECTION).doc(communityDocument.id);
    caseEntries.push({
      communityDocument,
      caseRef,
      caseSnapshot: await transaction.get(caseRef),
    });
  }

  let openedCaseCount = 0;
  let existingOpenCaseCount = 0;
  let inconsistentCaseCount = 0;
  const deadlineAt =
    input.now + COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS;

  for (const entry of caseEntries) {
    const community = entry.communityDocument.data() ?? {};
    const currentOwnerUid = String(community['ownerUid'] ?? '').trim();

    if (currentOwnerUid !== ownerUid) {
      inconsistentCaseCount += 1;
      continue;
    }

    if (entry.caseSnapshot.exists) {
      const existingCase = entry.caseSnapshot.data() ?? {};
      const existingOwnerUid = String(
        existingCase['previousOwnerUid'] ?? ''
      ).trim();
      const existingStatus = String(existingCase['status'] ?? '').trim();
      const existingDeadlineAt = Number(existingCase['deadlineAt']);

      if (
        existingStatus === 'open'
        && existingOwnerUid === ownerUid
        && Number.isFinite(existingDeadlineAt)
        && existingDeadlineAt > input.now
      ) {
        existingOpenCaseCount += 1;
        continue;
      }

      inconsistentCaseCount += 1;
      continue;
    }

    transaction.set(entry.caseRef, {
      policyVersion: COMMUNITY_OWNERSHIP_WORKFLOW_POLICY_VERSION,
      communityId: entry.communityDocument.id,
      previousOwnerUid: ownerUid,
      trigger: input.trigger,
      status: 'open',
      activeRequestId: null,
      openedByUid: input.actorUid,
      openedAt: input.now,
      deadlineAt,
      updatedAt: input.now,
      source: 'account-lifecycle-purge',
    });

    transaction.set(entry.communityDocument.ref, {
      ownershipSuccession: {
        state: 'open',
        mode: 'terminal_succession',
        trigger: input.trigger,
        previousOwnerUid: ownerUid,
        openedAt: input.now,
        deadlineAt,
        updatedAt: input.now,
      },
      updatedAt: input.now,
    }, { merge: true });

    transaction.set(
      db.collection('community_membership_audit').doc(),
      {
        action: 'community_owner_terminal_succession_opened',
        communityId: entry.communityDocument.id,
        actorUid: input.actorUid,
        previousOwnerUid: ownerUid,
        trigger: input.trigger,
        deadlineAt,
        createdAt: input.now,
        source: 'account-lifecycle-purge',
      }
    );

    openedCaseCount += 1;
  }

  return Object.freeze({
    ownedCommunityCount: communityDocuments.length,
    openedCaseCount,
    existingOpenCaseCount,
    inconsistentCaseCount,
    exceedsAutomaticLimit: false,
    communityIds: Object.freeze(
      communityDocuments.map((document) => document.id)
    ),
  });
}
