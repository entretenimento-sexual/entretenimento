// functions/src/compliance/age-verification-provider-assertion.trigger.ts
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  safeNotifyInitialAgeEligibilityOutcome,
} from '../moderation/moderation-safety-notification.service';
import {
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';
import {
  writeCanonicalAgeEligibilityInTransaction,
} from './age-eligibility.service';
import {
  normalizeProviderAgeAssertion,
  resolveProviderAssertionCanonicalStatus,
} from './age-verification-provider-assertion.policy';

export const processAgeVerificationProviderAssertion = onDocumentCreated(
  {
    document: 'age_verification_provider_assertions/{assertionId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const assertionId = String(event.params['assertionId'] ?? '').trim();
    const assertion = normalizeProviderAgeAssertion({
      assertionId,
      raw: snapshot.data(),
    });

    if (!assertion) {
      await snapshot.ref.set({
        processingStatus: 'REJECTED_INVALID',
        processedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      logger.error('age_provider_assertion_rejected_invalid', {
        assertionId,
      });
      return;
    }

    const processedStatus = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(assertion.uid);
      const recordRef = db
        .collection('age_eligibility_records')
        .doc(assertion.uid);
      const [userSnapshot, recordSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(recordRef),
      ]);

      if (!userSnapshot.exists) {
        transaction.set(snapshot.ref, {
          processingStatus: 'USER_NOT_FOUND',
          processedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return 'USER_NOT_FOUND' as const;
      }

      const current = evaluateCanonicalAgeEligibility({
        uid: assertion.uid,
        rawRecord: recordSnapshot.exists ? recordSnapshot.data() : null,
      });
      const nextStatus = resolveProviderAssertionCanonicalStatus({
        currentStatus: current.status,
        assertionResult: assertion.result,
      });
      const decidedAtMs = Date.now();
      const projection = writeCanonicalAgeEligibilityInTransaction(
        transaction,
        {
          uid: assertion.uid,
          status: nextStatus,
          source: 'INITIAL_VERIFICATION',
          method: 'EXTERNAL_PROVIDER',
          caseId: assertion.assertionId,
          verifiedAtMs:
            nextStatus === 'VERIFIED_ADULT'
              ? assertion.verifiedAtMs
              : null,
          decidedAtMs,
          expiresAtMs:
            nextStatus === 'VERIFIED_ADULT'
              ? assertion.expiresAtMs
              : null,
        }
      );

      transaction.set(userRef, {
        ageEligibility: projection,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.set(snapshot.ref, {
        processingStatus:
          nextStatus === 'REVIEW_REQUIRED'
            ? 'REVIEW_REQUIRED'
            : 'PROCESSED',
        canonicalStatus: nextStatus,
        processedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      transaction.create(db.collection('compliance_audit').doc(), {
        uid: assertion.uid,
        type: 'age_eligibility.provider_assertion_processed',
        source: 'provider',
        provider: assertion.provider,
        assuranceLevel: assertion.assuranceLevel,
        assertionId: assertion.assertionId,
        canonicalStatus: nextStatus,
        providerReferenceHash: assertion.providerReferenceHash,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: decidedAtMs,
      });

      return nextStatus;
    });

    if (
      processedStatus === 'VERIFIED_ADULT' ||
      processedStatus === 'DENIED_UNDERAGE' ||
      processedStatus === 'REVIEW_REQUIRED'
    ) {
      await safeNotifyInitialAgeEligibilityOutcome({
        assertionId: assertion.assertionId,
        uid: assertion.uid,
        status: processedStatus,
      });
    }
  }
);
