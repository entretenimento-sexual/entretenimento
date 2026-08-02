export type PrivateMediaDraftDomainErrorCode =
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

interface CallableErrorShape {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

interface CallableErrorDetailsShape {
  code?: unknown;
  recovery?: unknown;
  retryable?: unknown;
}

const DOMAIN_CODES = new Set<PrivateMediaDraftDomainErrorCode>([
  'MEDIA_DRAFT_ITEM_LIMIT',
  'MEDIA_DRAFT_BYTE_LIMIT',
  'MEDIA_UPLOAD_RESERVATION_EXPIRED',
  'MEDIA_UPLOAD_RESERVATION_MISMATCH',
  'MEDIA_UPLOAD_NOT_ALLOWED',
  'MEDIA_EMAIL_VERIFICATION_REQUIRED',
  'MEDIA_ADULT_ACCESS_REQUIRED',
  'MEDIA_TERMS_REQUIRED',
  'MEDIA_PROFILE_INCOMPLETE',
  'MEDIA_DRAFT_UNPUBLISH_CAPACITY_EXCEEDED',
  'MEDIA_DRAFT_CLEANUP_PENDING',
  'MEDIA_DRAFT_RECONCILIATION_CONFLICT',
  'MEDIA_DRAFT_RECONCILIATION_FORBIDDEN',
]);

export class PrivateMediaDraftOperationError extends Error {
  readonly name = 'PrivateMediaDraftOperationError';

  constructor(
    readonly domainCode: PrivateMediaDraftDomainErrorCode,
    message: string,
    readonly recovery: string,
    readonly retryable: boolean,
    readonly code: string,
    readonly original: unknown
  ) {
    super(message);
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function cleanText(value: unknown, maximumLength: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function domainCode(value: unknown): PrivateMediaDraftDomainErrorCode | null {
  const normalized = cleanText(value, 80) as PrivateMediaDraftDomainErrorCode;
  return DOMAIN_CODES.has(normalized) ? normalized : null;
}

export function normalizePrivateMediaDraftOperationError(
  error: unknown,
  fallbackMessage: string
): Error {
  if (error instanceof PrivateMediaDraftOperationError) {
    return error;
  }

  const callable = record(error) as CallableErrorShape;
  const details = record(callable.details) as CallableErrorDetailsShape;
  const normalizedDomainCode = domainCode(details.code);

  if (!normalizedDomainCode) {
    return error instanceof Error
      ? error
      : new Error(fallbackMessage);
  }

  const message = cleanText(callable.message, 500) || fallbackMessage;
  const recovery = cleanText(details.recovery, 500) ||
    'Revise os dados da conta ou do arquivo e tente novamente.';
  const firebaseCode = cleanText(callable.code, 120) || 'functions/unknown';

  return new PrivateMediaDraftOperationError(
    normalizedDomainCode,
    message,
    recovery,
    details.retryable === true,
    firebaseCode,
    error
  );
}
