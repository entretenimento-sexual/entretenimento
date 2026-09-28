// functions/src/promotion-boost/promotion-boost-commercial-authority.ts
// -----------------------------------------------------------------------------
// PROMOTION / BOOST COMMERCIAL AUTHORITY
// -----------------------------------------------------------------------------
// Fronteira canônica do domínio Promotion/Boost para configuração comercial e
// elegibilidade do anunciante. O storage físico ainda reutiliza as coleções
// históricas do Community Boost para preservar dados e comportamento existentes;
// esse detalhe legado fica confinado a este adapter.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  normalizePromotionBoostAdvertiserAccount as normalizeCanonicalPromotionBoostAdvertiserAccount,
  normalizePromotionBoostBillingConfig as normalizeCanonicalPromotionBoostBillingConfig,
  type PromotionBoostAdvertiserAccount,
  type PromotionBoostBillingConfig,
} from './promotion-boost.policy';

const LEGACY_BILLING_CONFIG_COLLECTION =
  'community_boost_billing_config' as const;
const LEGACY_ADVERTISER_ACCOUNTS_COLLECTION =
  'community_boost_advertiser_accounts' as const;

export const PROMOTION_BOOST_ADVERTISER_ACCOUNT_DOCUMENT =
  `${LEGACY_ADVERTISER_ACCOUNTS_COLLECTION}/{advertiserUid}`;

export function promotionBoostBillingConfigRef() {
  return db.collection(LEGACY_BILLING_CONFIG_COLLECTION).doc('current');
}

export function promotionBoostAdvertiserAccountRef(advertiserUid: string) {
  return db.collection(LEGACY_ADVERTISER_ACCOUNTS_COLLECTION).doc(advertiserUid);
}

export function normalizePromotionBoostBillingConfig(
  raw: unknown
): PromotionBoostBillingConfig | null {
  return normalizeCanonicalPromotionBoostBillingConfig(raw);
}

export function normalizePromotionBoostAdvertiserAccount(
  raw: unknown,
  expectedAdvertiserUid?: string
): PromotionBoostAdvertiserAccount | null {
  return normalizeCanonicalPromotionBoostAdvertiserAccount(
    raw,
    expectedAdvertiserUid
  );
}


export function resolvePhotoPromotionAdvertiserAuthority(input: {
  readonly advertiserUid: string;
  readonly targetOwnerUid: string;
  readonly rawAdvertiserAccount: unknown;
}): Readonly<PromotionBoostAdvertiserAccount> | null {
  const advertiser = normalizePromotionBoostAdvertiserAccount(
    input.rawAdvertiserAccount,
    input.advertiserUid
  );

  if (!advertiser || input.advertiserUid !== input.targetOwnerUid) {
    return null;
  }

  return advertiser;
}
