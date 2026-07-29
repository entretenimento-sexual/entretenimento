export type ComplianceCaseCategory =
  | 'AGE_OR_IDENTITY'
  | 'NON_CONSENSUAL_CONTENT'
  | 'ILLEGAL_CONTENT'
  | 'HARASSMENT_OR_THREAT'
  | 'FRAUD_OR_PAYMENT_ABUSE'
  | 'ACCOUNT_INTEGRITY'
  | 'OTHER_TERMS_VIOLATION';

export type ComplianceCaseStatus =
  | 'AWAITING_USER_RESPONSE'
  | 'USER_RESPONDED'
  | 'UNDER_REVIEW'
  | 'RESOLVED_NO_VIOLATION'
  | 'RESOLVED_ACTION_TAKEN'
  | 'CLOSED';

export interface ComplianceCaseItem {
  caseId: string;
  category: ComplianceCaseCategory;
  summary: string;
  policySection: string;
  preventiveMeasure: string | null;
  status: ComplianceCaseStatus;
  presumption: 'SUSPECTED_NOT_CONFIRMED' | string;
  responseDueAt: number | null;
  userResponse: string | null;
  userRespondedAt: number | null;
  resolution: string | null;
  resolvedAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
}

export interface ComplianceCasesVm {
  loading: boolean;
  submittingCaseId: string | null;
  items: ComplianceCaseItem[];
  error: string | null;
}
