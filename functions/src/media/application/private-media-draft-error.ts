import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

export type PrivateMediaDraftErrorCode =
  | 'MEDIA_DRAFT_ITEM_LIMIT'
  | 'MEDIA_DRAFT_BYTE_LIMIT'
  | 'MEDIA_UPLOAD_RESERVATION_EXPIRED'
  | 'MEDIA_UPLOAD_RESERVATION_MISMATCH'
  | 'MEDIA_UPLOAD_NOT_ALLOWED'
  | 'MEDIA_EMAIL_VERIFICATION_REQUIRED'
  | 'MEDIA_ADULT_ACCESS_REQUIRED'
  | 'MEDIA_TERMS_REQUIRED'
  | 'MEDIA_PROFILE_INCOMPLETE'
  | 'MEDIA_DRAFT_UNPUBLISH_CAPACITY_EXCEEDED'
  | 'MEDIA_DRAFT_CLEANUP_PENDING'
  | 'MEDIA_DRAFT_RECONCILIATION_CONFLICT'
  | 'MEDIA_DRAFT_RECONCILIATION_FORBIDDEN';

export interface PrivateMediaDraftErrorDetails {
  code: PrivateMediaDraftErrorCode;
  retryable: boolean;
  recovery: string;
}

export function privateMediaDraftHttpsError(
  firebaseCode: FunctionsErrorCode,
  code: PrivateMediaDraftErrorCode,
  message: string,
  recovery: string,
  retryable = false
): HttpsError {
  return new HttpsError(
    firebaseCode,
    message,
    {
      code,
      retryable,
      recovery,
    } satisfies PrivateMediaDraftErrorDetails
  );
}
