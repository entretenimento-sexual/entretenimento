// src/app/core/services/data-handling/converters/user.firestore-converter.ts
// Centraliza a conversão entre Firestore e IUserDados. Instâncias Timestamp não
// podem atravessar para NgRx/cache; datas de assinatura permanecem epoch no app.
import {
  FirestoreDataConverter,
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';
import {
  IUserDados,
  TermsAcceptanceContext,
} from '../../../interfaces/iuser-dados';
import { toEpoch, toTimestamp } from 'src/app/core/utils/epoch-utils';

function nullableText(value: unknown): string | null {
  return String(value ?? '').trim() || null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function termsAcceptanceContext(
  value: unknown
): TermsAcceptanceContext | null {
  return value === 'initial' || value === 'material_update'
    ? value
    : null;
}

export const userConverter: FirestoreDataConverter<IUserDados> = {
  fromFirestore(
    snap: QueryDocumentSnapshot,
    options: SnapshotOptions
  ): IUserDados {
    const d: any = snap.data(options);
    const ms = (value: unknown) => toEpoch(value as any) ?? null;

    return {
      ...d,
      uid: snap.id,

      lastLogin: ms(d.lastLogin) ?? 0,
      firstLogin: ms(d.firstLogin),
      createdAt: ms(d.createdAt),
      subscriptionStartedAt: ms(d.subscriptionStartedAt),
      subscriptionEndsAt: ms(d.subscriptionEndsAt),
      subscriptionExpires: ms(d.subscriptionExpires),
      billingUpdatedAt: ms(d.billingUpdatedAt),
      lastSeen: ms(d.lastSeen),
      lastLocationAt: ms(d.lastLocationAt),
      registrationDate: ms(d.registrationDate),
      lastOfflineAt: ms(d.lastOfflineAt),
      lastOnlineAt: ms(d.lastOnlineAt),

      ...(d.acceptedTerms
        ? {
            acceptedTerms: {
              accepted: d.acceptedTerms.accepted === true,
              date: ms(d.acceptedTerms.date),
              version: nullableText(d.acceptedTerms.version),
              termsDocumentVersion: nullableText(
                d.acceptedTerms.termsDocumentVersion
              ),
              privacyNoticeVersion: nullableText(
                d.acceptedTerms.privacyNoticeVersion
              ),
              acknowledgedPrivacyNotice: nullableBoolean(
                d.acceptedTerms.acknowledgedPrivacyNotice
              ),
              adultAccessAcknowledgement: nullableBoolean(
                d.acceptedTerms.adultAccessAcknowledgement
              ),
              acceptanceContext: termsAcceptanceContext(
                d.acceptedTerms.acceptanceContext
              ),
              previousVersion: nullableText(
                d.acceptedTerms.previousVersion
              ),
              acceptedAt: ms(d.acceptedTerms.acceptedAt),
              updatedAt: ms(d.acceptedTerms.updatedAt),
              source: nullableText(d.acceptedTerms.source),
            },
          }
        : {}),

      ...(Array.isArray(d.nicknameHistory)
        ? {
            nicknameHistory: d.nicknameHistory.map((item: any) => ({
              nickname: item?.nickname ?? '',
              date: ms(item?.date),
            })),
          }
        : {}),
    } as IUserDados;
  },

  toFirestore(user: IUserDados): DocumentData {
    const {
      lastLogin,
      firstLogin,
      createdAt,
      subscriptionStartedAt,
      subscriptionEndsAt,
      subscriptionExpires,
      lastSeen,
      lastLocationAt,
      registrationDate,
      lastOfflineAt,
      lastOnlineAt,
      acceptedTerms,
      nicknameHistory,
      ...rest
    } = user;

    const ts = (value: unknown) => toTimestamp(value as any);

    return {
      ...rest,

      ...(lastLogin > 0 ? { lastLogin: ts(lastLogin) } : {}),
      ...(firstLogin ? { firstLogin: ts(firstLogin) } : {}),
      ...(createdAt ? { createdAt: ts(createdAt) } : {}),
      ...(subscriptionStartedAt
        ? { subscriptionStartedAt: ts(subscriptionStartedAt) }
        : {}),
      ...(subscriptionEndsAt
        ? { subscriptionEndsAt: ts(subscriptionEndsAt) }
        : {}),
      ...(subscriptionExpires
        ? { subscriptionExpires: ts(subscriptionExpires) }
        : {}),
      ...(lastSeen ? { lastSeen: ts(lastSeen) } : {}),
      ...(lastLocationAt ? { lastLocationAt: ts(lastLocationAt) } : {}),
      ...(registrationDate ? { registrationDate: ts(registrationDate) } : {}),
      ...(lastOfflineAt ? { lastOfflineAt: ts(lastOfflineAt) } : {}),
      ...(lastOnlineAt ? { lastOnlineAt: ts(lastOnlineAt) } : {}),

      ...(acceptedTerms
        ? {
            acceptedTerms: {
              accepted: acceptedTerms.accepted === true,
              date: ts(acceptedTerms.date ?? null),
              ...(acceptedTerms.version
                ? { version: acceptedTerms.version }
                : {}),
              ...(acceptedTerms.termsDocumentVersion
                ? {
                    termsDocumentVersion:
                      acceptedTerms.termsDocumentVersion,
                  }
                : {}),
              ...(acceptedTerms.privacyNoticeVersion
                ? {
                    privacyNoticeVersion:
                      acceptedTerms.privacyNoticeVersion,
                  }
                : {}),
              ...(typeof acceptedTerms.acknowledgedPrivacyNotice === 'boolean'
                ? {
                    acknowledgedPrivacyNotice:
                      acceptedTerms.acknowledgedPrivacyNotice,
                  }
                : {}),
              ...(typeof acceptedTerms.adultAccessAcknowledgement === 'boolean'
                ? {
                    adultAccessAcknowledgement:
                      acceptedTerms.adultAccessAcknowledgement,
                  }
                : {}),
              ...(acceptedTerms.acceptanceContext
                ? { acceptanceContext: acceptedTerms.acceptanceContext }
                : {}),
              ...(acceptedTerms.previousVersion !== undefined
                ? {
                    previousVersion:
                      acceptedTerms.previousVersion ?? null,
                  }
                : {}),
              ...(acceptedTerms.acceptedAt
                ? { acceptedAt: ts(acceptedTerms.acceptedAt) }
                : {}),
              ...(acceptedTerms.updatedAt
                ? { updatedAt: ts(acceptedTerms.updatedAt) }
                : {}),
              ...(acceptedTerms.source
                ? { source: acceptedTerms.source }
                : {}),
            },
          }
        : {}),

      ...(Array.isArray(nicknameHistory)
        ? {
            nicknameHistory: nicknameHistory.map((item) => ({
              nickname: item?.nickname ?? '',
              date: ts(item?.date ?? null),
            })),
          }
        : {}),
    };
  },
};
