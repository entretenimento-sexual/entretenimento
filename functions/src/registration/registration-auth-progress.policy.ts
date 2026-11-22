import type { UserRecord } from 'firebase-admin/auth';

export const REGISTRATION_EMAIL_LINK_UID_PREFIX = 'email-link-preview-';

type RegistrationAuthStage = 'emailPending' | 'passwordPending' | 'credentialsReady';
type AuthProgressSource = Pick<UserRecord, 'uid' | 'emailVerified' | 'passwordHash'> & {
  metadata: Pick<UserRecord['metadata'], 'creationTime'>;
};

export interface RegistrationAuthProgress {
  stage: RegistrationAuthStage;
  observedAtMs: number;
}

function validMillis(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function resolveRegistrationAuthProgress(
  account: FirebaseFirestore.DocumentData | undefined,
  auth: AuthProgressSource,
  nowMs: number,
): RegistrationAuthProgress {
  const stage = !auth.emailVerified ? 'emailPending'
    : auth.uid.startsWith(REGISTRATION_EMAIL_LINK_UID_PREFIX) && !auth.passwordHash
      ? 'passwordPending' : 'credentialsReady';
  const previous = account?.registrationAuthProgress;
  if (previous?.stage === stage && validMillis(previous.observedAtMs)) return previous;

  if (account && previous == null) {
    const marker = account.registrationAbandonment;
    const knownStage = marker?.stage === 'termsPending' || marker?.stage === 'profilePending'
      ? 'credentialsReady' : marker?.stage;
    if (knownStage === stage && validMillis(marker.activityAtMs) && marker.activityAtMs <= nowMs) {
      return { stage, observedAtMs: marker.activityAtMs };
    }
    const createdAtMs = Date.parse(auth.metadata.creationTime);
    if (marker == null && stage === 'emailPending' && validMillis(createdAtMs) && createdAtMs <= nowMs) {
      return { stage, observedAtMs: createdAtMs };
    }
  }
  // Auth expõe o estado atual, sem informar a data de confirmação do e-mail.
  // Se o estado avançou fora do app, a primeira observação é o novo marco.
  return { stage, observedAtMs: nowMs };
}
