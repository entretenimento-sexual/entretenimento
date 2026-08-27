import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-moderation-evidence-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;
const USER_UID = 'reporter-user';
const ADMIN_UID = 'moderation-admin';
const REPORT_ID = 'photo-report-direct-client';
const EVIDENCE_ID = 'evidence-case-1';

let testEnv: RulesTestEnvironment;

function reportRef(db: Firestore) {
  return doc(db, 'moderation_reports', REPORT_ID);
}

function evidenceRef(db: Firestore) {
  return doc(db, 'moderation_evidence', EVIDENCE_ID);
}

function preservationJobRef(db: Firestore) {
  return doc(db, 'moderation_evidence_preservation_jobs', EVIDENCE_ID);
}

function legalReviewCaseRef(db: Firestore) {
  return doc(db, 'moderation_legal_review_cases', EVIDENCE_ID);
}

describe('Firestore Rules / moderation evidence', () => {
  beforeAll(async () => {
    const rules = readFileSync(
      resolve(process.cwd(), 'firestore.rules'),
      'utf8'
    );

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      await setDoc(reportRef(db), {
        reporterUid: USER_UID,
        targetType: 'photo',
        targetId: 'photo-1',
        parentTargetId: null,
        targetOwnerUid: 'owner-1',
        targetAuthorUid: 'owner-1',
        reason: 'illegal_content',
        details: null,
        route: '/media/perfil/owner-1/fotos-publicas',
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(evidenceRef(db), {
        reportId: EVIDENCE_ID,
        evidenceType: 'TEXT_SNAPSHOT',
        accessPolicy: 'BACKEND_ONLY',
      });
      await setDoc(preservationJobRef(db), {
        reportId: EVIDENCE_ID,
        status: 'PENDING',
      });
      await setDoc(legalReviewCaseRef(db), {
        reportId: EVIDENCE_ID,
        status: 'PENDING_LEGAL_REVIEW',
        authorityDisclosureStatus: 'NOT_EVALUATED',
        accessPolicy: 'BACKEND_ONLY',
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('nega criação direta de denúncia de foto pelo cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'moderation_reports', 'forged-photo-report'), {
        reporterUid: USER_UID,
        targetType: 'photo',
        targetId: 'photo-1',
        parentTargetId: null,
        targetOwnerUid: 'owner-1',
        targetAuthorUid: 'owner-1',
        reason: 'illegal_content',
        details: null,
        route: '/media/perfil/owner-1/fotos-publicas',
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega criação direta de denúncia do Mural pelo cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'moderation_reports', 'forged-community-post-report'), {
        reporterUid: USER_UID,
        targetType: 'community_feed_post',
        targetId: 'post-1',
        parentTargetId: 'community-1',
        targetOwnerUid: null,
        targetAuthorUid: 'author-1',
        reason: 'harassment',
        details: null,
        route: '/comunidades/community-1',
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      setDoc(doc(db, 'moderation_reports', 'forged-community-comment-report'), {
        reporterUid: USER_UID,
        targetType: 'community_feed_comment',
        targetId: 'comment-1',
        parentTargetId: 'post-1',
        containerTargetId: 'community-1',
        targetOwnerUid: null,
        targetAuthorUid: 'author-1',
        reason: 'harassment',
        details: null,
        route: '/comunidades/community-1',
        status: 'open',
        moderationAction: null,
        source: 'web',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('permite admin assumir mídia, mas nega decisão final direta', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID, {
      admin: true,
      role: 'admin',
    }).firestore();
    const ref = reportRef(adminDb);

    await assertSucceeds(
      updateDoc(ref, {
        status: 'reviewing',
        resolution: 'Caso assumido para revisão.',
        reviewedBy: ADMIN_UID,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(ref, {
        status: 'reviewing',
        moderationAction: 'REMOVE',
        resolution: 'Tentativa de contaminar a decisão durante a triagem.',
        reviewedBy: ADMIN_UID,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(ref, {
        status: 'resolved',
        moderationAction: 'REMOVE',
        resolution: 'Tentativa de contornar a Callable especializada.',
        reviewedBy: ADMIN_UID,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertFails(
      updateDoc(ref, {
        status: 'rejected',
        moderationAction: 'KEEP',
        resolution: 'Tentativa de manter mídia sem a Callable especializada.',
        reviewedBy: ADMIN_UID,
        reviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega leitura de evidência e caso legal até para sessão admin do cliente', async () => {
    const adminDb = testEnv.authenticatedContext(ADMIN_UID, {
      admin: true,
      role: 'admin',
    }).firestore();

    await assertFails(getDoc(evidenceRef(adminDb)));
    await assertFails(getDoc(preservationJobRef(adminDb)));
    await assertFails(getDoc(legalReviewCaseRef(adminDb)));
  });

  it('nega criação, alteração e exclusão de evidência pelo cliente', async () => {
    const db = testEnv.authenticatedContext(USER_UID).firestore();

    await assertFails(
      setDoc(doc(db, 'moderation_evidence', 'forged-evidence'), {
        accessPolicy: 'BACKEND_ONLY',
      })
    );
    await assertFails(
      updateDoc(evidenceRef(db), { accessPolicy: 'PUBLIC' })
    );
    await assertFails(deleteDoc(evidenceRef(db)));

    await assertFails(
      setDoc(doc(db, 'moderation_evidence_preservation_jobs', 'forged-job'), {
        status: 'PENDING',
      })
    );
    await assertFails(updateDoc(preservationJobRef(db), { status: 'DONE' }));
    await assertFails(deleteDoc(preservationJobRef(db)));

    await assertFails(
      setDoc(doc(db, 'moderation_legal_review_cases', 'forged-case'), {
        status: 'APPROVED_FOR_DISCLOSURE',
      })
    );
    await assertFails(
      updateDoc(legalReviewCaseRef(db), {
        authorityDisclosureStatus: 'DISCLOSED',
      })
    );
    await assertFails(deleteDoc(legalReviewCaseRef(db)));
  });
});
