// src/app/core/interfaces/compliance/adult-consent.interface.ts

import { Timestamp } from '@angular/fire/firestore';

export interface AdultConsentRecord {
  accepted: boolean;
  version: string;
  acceptedAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  source?: 'web' | 'mobile' | 'admin' | string;
}

export interface AdultConsentDocumentPatch {
  adultConsent: {
    accepted: boolean;
    version: string;
    acceptedAt: unknown;
    updatedAt: unknown;
    source: 'web';
  };
  uid: string;
}
