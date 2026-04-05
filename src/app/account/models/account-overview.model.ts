//src\app\account\models\account-overview.model.ts
export interface AccountOverviewVm {
  uid: string | null;
  nickname: string | null;
  profilePath: string | null;

  email: string | null;
  emailVerified: boolean;
  emailStatusLabel: string;
  verificationHint: string;

  roleLabel: string;
  memberSince: number | null;
  lastLoginAt: number | null;

  localeLabel: string;
  localeCode: string;

  locationLabel: string;
  locationDetails: string;

  googleLinked: boolean;
  passwordConfigured: boolean;

  twoFactorEnabled: boolean;
  twoFactorHint: string;

  subscriptionLabel: string;
  tokensBalance: number | null;

  quickPurchaseEnabled: boolean | null;

  canManageDevices: boolean;
  devicesRoute: string;

  canBlockAccount: boolean;
  canDeleteAccount: boolean;
}