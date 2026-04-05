//src\app\payments-core\domain\models\creator-profile.model.ts
import { BillingProvider } from './billing-plan.model';

export type ProfessionalStatus =
  | 'disabled'
  | 'pending_review'
  | 'active'
  | 'suspended';

export interface CreatorProfileDoc {
  uid: string;
  professionalModeEnabled: boolean;
  professionalStatus: ProfessionalStatus;
  headline?: string;
  bio?: string;
  acceptsTips: boolean;
  acceptsPaidMessages: boolean;
  acceptsPaidMedia: boolean;
  acceptsPaidLives: boolean;
  provider: BillingProvider | null;
  providerAccountId?: string | null;
  createdAt: number;
  updatedAt: number;
}