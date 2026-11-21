import type { Auth } from 'firebase-admin/auth';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
  assessRegistrationAbandonment,
  classifyRegistrationDraft,
  nextRegistrationAbandonment,
  REGISTRATION_EMAIL_LINK_DRAFTS,
  REGISTRATION_INACTIVITY_DAYS,
} from './registration-abandonment.policy';

interface SweepOptions {
  apply: boolean;
  nowMs: number;
  /** Reprocess a bounded page per scheduled invocation. CLI traverses the entire inventory. */
  scheduled?: boolean;
}
const PAGE_SIZE = 100;

async function readAssessment(
  db: FirebaseFirestore.Firestore, ref: FirebaseFirestore.DocumentReference,
  account: FirebaseFirestore.DocumentData | undefined, user: Awaited<ReturnType<Auth['getUser']>> | undefined,
  nowMs: number,
  transaction?: FirebaseFirestore.Transaction,
) {
  const uid = ref.id;
  const read = transaction ?? db;
  const [age, profile] = await read.getAll(
    db.doc(`age_eligibility_records/${uid}`), db.doc(`public_profiles/${uid}`),
  );
  const assessment = assessRegistrationAbandonment(uid, account, user, age.data(), profile.exists, nowMs);
  if (assessment.kind !== 'candidate') return assessment;

  const financialLinks = [
    ['subscriptions', 'buyerUid'],
    ['payment_transactions', 'buyerUid'],
    ['payment_transactions', 'sellerUid'],
    ['entitlements', 'buyerUid'],
    ['entitlements', 'sellerUid'],
  ];
  const links = await Promise.all(financialLinks.map(([collection, field]) => {
    const query = db.collection(collection).where(field, '==', uid).limit(1).select();
    return transaction ? transaction.get(query) : query.get();
  }));
  return links.some(snapshot => !snapshot.empty) ? { kind: 'protected' } as const : assessment;
}

async function readCurrentAuth(auth: Auth, uid: string) {
  return auth.getUser(uid).catch((error: { code?: string }) => {
    if (error.code === 'auth/user-not-found') return undefined;
    throw error;
  });
}

export async function sweepRegistrationAbandonment(
  db: FirebaseFirestore.Firestore,
  auth: Auth,
  { apply, nowMs, scheduled = false }: SweepOptions,
) {
  const stages = {
    emailPending: { days: REGISTRATION_INACTIVITY_DAYS.emailPending, active: 0, candidates: 0 },
    passwordPending: { days: REGISTRATION_INACTIVITY_DAYS.passwordPending, active: 0, candidates: 0 },
    termsPending: { days: REGISTRATION_INACTIVITY_DAYS.termsPending, active: 0, candidates: 0 },
    profilePending: { days: REGISTRATION_INACTIVITY_DAYS.profilePending, active: 0, candidates: 0 },
  };
  const accounts = { stages, protected: 0, unclassified: 0 };
  const drafts = { expiredDrafts: 0, validDrafts: 0, accountReceipts: 0, unclassified: 0 };
  const changes = { opened: 0, readyForReview: 0, cleared: 0, deletedDrafts: 0 };
  const checkpoint = db.doc('registration_abandonment_operations/sweep');
  const cursors = scheduled ? (await checkpoint.get()).data() : undefined;
  const queries = {
    drafts: db.collection(REGISTRATION_EMAIL_LINK_DRAFTS)
      .select('expiresAtMs', 'adultDeclaredAtMs', 'adultDeclarationVersion', 'oobCodeHash'),
    accounts: db.collection('users').where('profileCompleted', '==', false).select(
      'uid', 'email', 'accountStatus', 'accountLocked', 'suspended', 'loginAllowed', 'registrationCompletedAt',
      'deletionRequestedAt', 'deletedAt', 'ageReverificationRestrictedAt', 'moderationAutomationHold.active',
      'legalHold', 'billingHold', 'isSubscriber', 'subscriptionStatus', 'currentSubscriptionId', 'entitlements',
      'ageReverification.status', 'registrationFlowVersion', 'publicVisibility', 'interactionBlocked',
      'profileCompleted', 'createdAt', 'acceptedTerms', 'nicknameHistory', 'registrationAbandonment',
    ),
  };

  async function scan(
    key: keyof typeof queries,
    visit: (page: FirebaseFirestore.QueryDocumentSnapshot[]) => Promise<void>,
  ) {
    const query = queries[key].orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    let cursor = typeof cursors?.[key] === 'string' ? cursors[key] : null;
    do {
      const page = await (cursor ? query.startAfter(cursor) : query).get();
      await visit(page.docs);
      cursor = page.size === PAGE_SIZE ? page.docs[page.docs.length - 1].id : null;
      if (scheduled && apply) await checkpoint.set({ [key]: cursor }, { merge: true });
    } while (!scheduled && cursor);
  }

  await scan('drafts', async page => {
    for (const doc of page) {
      const kind = classifyRegistrationDraft(doc.id, doc.data(), nowMs);
      drafts[kind]++;
      if (!apply || kind !== 'expiredDrafts') continue;
      const deleted = await db.runTransaction(async tx => {
        const current = (await tx.get(doc.ref)).data();
        if (!current || classifyRegistrationDraft(doc.id, current, nowMs) !== 'expiredDrafts') return false;
        tx.delete(doc.ref);
        return true;
      });
      if (deleted) changes.deletedDrafts++;
    }
  });

  await scan('accounts', async page => {
    if (!page.length) return;
    const { users } = await auth.getUsers(page.map(doc => ({ uid: doc.id })));
    const found = new Map(users.map(user => [user.uid, user]));
    for (const doc of page) {
      const account = doc.data();
      const assessment = await readAssessment(db, doc.ref, account, found.get(doc.id), nowMs);
      if ('stage' in assessment) {
        stages[assessment.stage][assessment.kind === 'active' ? 'active' : 'candidates']++;
      } else {
        accounts[assessment.kind]++;
      }
      if (!apply || (assessment.kind !== 'candidate' && account.registrationAbandonment == null)) continue;

      const change = await db.runTransaction(async tx => {
        const current = (await tx.get(doc.ref)).data();
        if (current?.profileCompleted !== false) return null;
        const user = await readCurrentAuth(auth, doc.id);
        const fresh = await readAssessment(db, doc.ref, current, user, nowMs, tx);
        const previous = current.registrationAbandonment;
        const next = nextRegistrationAbandonment(fresh, previous, nowMs);
        if (previous === next || (previous == null && next == null)) return null;
        tx.update(doc.ref, { registrationAbandonment: next ?? FieldValue.delete() });
        if (!next) return 'cleared';
        return next.status === 'review_ready' ? 'readyForReview' : 'opened';
      });
      if (change) changes[change]++;
    }
  });

  return { ...drafts, accounts, changes };
}
