import {
  DocumentData,
  QueryDocumentSnapshot,
  SnapshotOptions,
  Timestamp,
} from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';

import { IUserDados } from '../../../interfaces/iuser-dados';
import { userConverter } from './user.firestore-converter';

const ACCEPTED_AT = 1_785_530_197_000;

function firestoreSnapshot(
  data: DocumentData
): QueryDocumentSnapshot<DocumentData> {
  return {
    id: 'user-1',
    data: vi.fn(() => data),
  } as unknown as QueryDocumentSnapshot<DocumentData>;
}

function runtimeUser(): IUserDados {
  return {
    uid: 'user-1',
    email: 'user@example.com',
    photoURL: null,
    role: 'free',
    lastLogin: ACCEPTED_AT,
    isSubscriber: false,
    descricao: '',
    acceptedTerms: {
      accepted: true,
      date: ACCEPTED_AT,
      version: 'v3',
      termsDocumentVersion: '2026-07-29.1',
      privacyNoticeVersion: '2026-07-29.1',
      acknowledgedPrivacyNotice: true,
      adultAccessAcknowledgement: true,
      acceptanceContext: 'material_update',
      previousVersion: 'v2',
      acceptedAt: ACCEPTED_AT,
      updatedAt: ACCEPTED_AT,
      source: 'web',
    },
  };
}

describe('userConverter / acceptedTerms', () => {
  it('hidrata toda a evidência jurídica usada pelos guards', () => {
    const snapshot = firestoreSnapshot({
      email: 'user@example.com',
      photoURL: null,
      role: 'free',
      lastLogin: Timestamp.fromMillis(ACCEPTED_AT),
      isSubscriber: false,
      descricao: '',
      acceptedTerms: {
        accepted: true,
        date: Timestamp.fromMillis(ACCEPTED_AT),
        version: 'v3',
        termsDocumentVersion: '2026-07-29.1',
        privacyNoticeVersion: '2026-07-29.1',
        acknowledgedPrivacyNotice: true,
        adultAccessAcknowledgement: true,
        acceptanceContext: 'material_update',
        previousVersion: 'v2',
        acceptedAt: Timestamp.fromMillis(ACCEPTED_AT),
        updatedAt: Timestamp.fromMillis(ACCEPTED_AT),
        source: 'web',
      },
    });

    const user = userConverter.fromFirestore(
      snapshot,
      {} as SnapshotOptions
    );

    expect(user.acceptedTerms).toEqual({
      accepted: true,
      date: ACCEPTED_AT,
      version: 'v3',
      termsDocumentVersion: '2026-07-29.1',
      privacyNoticeVersion: '2026-07-29.1',
      acknowledgedPrivacyNotice: true,
      adultAccessAcknowledgement: true,
      acceptanceContext: 'material_update',
      previousVersion: 'v2',
      acceptedAt: ACCEPTED_AT,
      updatedAt: ACCEPTED_AT,
      source: 'web',
    });
  });

  it('não descarta a evidência jurídica em uma serialização completa', () => {
    const document = userConverter.toFirestore(runtimeUser());
    const acceptedTerms = document['acceptedTerms'] as Record<string, unknown>;

    expect(acceptedTerms['accepted']).toBe(true);
    expect(acceptedTerms['version']).toBe('v3');
    expect(acceptedTerms['termsDocumentVersion']).toBe('2026-07-29.1');
    expect(acceptedTerms['privacyNoticeVersion']).toBe('2026-07-29.1');
    expect(acceptedTerms['acknowledgedPrivacyNotice']).toBe(true);
    expect(acceptedTerms['adultAccessAcknowledgement']).toBe(true);
    expect(acceptedTerms['acceptanceContext']).toBe('material_update');
    expect(acceptedTerms['previousVersion']).toBe('v2');
    expect(
      (acceptedTerms['date'] as Timestamp).toMillis()
    ).toBe(ACCEPTED_AT);
    expect(
      (acceptedTerms['acceptedAt'] as Timestamp).toMillis()
    ).toBe(ACCEPTED_AT);
    expect(
      (acceptedTerms['updatedAt'] as Timestamp).toMillis()
    ).toBe(ACCEPTED_AT);
  });
});
