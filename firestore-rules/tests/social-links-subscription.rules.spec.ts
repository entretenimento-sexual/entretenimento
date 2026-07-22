// firestore-rules/tests/social-links-subscription.rules.spec.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-entretenimento-rules';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8180;

const SUBSCRIBER_UID = 'social-subscriber';
const FREE_UID = 'social-free';
const EXPIRED_UID = 'social-expired';
const VISITOR_UID = 'social-visitor';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedSubscription(
  uid: string,
  state: 'active' | 'inactive' | 'expired'
): Promise<void> {
  const now = Date.now();
  const active = state === 'active';
  const startedAt = state === 'inactive'
    ? null
    : Timestamp.fromMillis(now - 60_000);
  const endsAt = state === 'active'
    ? Timestamp.fromMillis(now + 60 * 60 * 1000)
    : state === 'expired'
      ? Timestamp.fromMillis(now - 1_000)
      : null;

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      uid,
      role: active ? 'premium' : 'free',
      tier: active ? 'premium' : 'free',
      billingProjectionVersion: 1,
      isSubscriber: state !== 'inactive',
      monthlyPayer: state !== 'inactive',
      subscriptionStatus: state === 'inactive' ? 'inactive' : 'active',
      subscriptionScope:
        state === 'inactive' ? null : 'platform_subscription',
      subscriptionStartedAt: startedAt,
      subscriptionEndsAt: endsAt,
      subscriptionExpires: endsAt,
    });
  });
}

async function seedSocialLinks(
  uid: string,
  options: {
    private?: boolean;
    public?: boolean;
  } = { private: true, public: true }
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    if (options.private) {
      await setDoc(
        doc(db, 'users', uid, 'profileData', 'socialLinks'),
        {
          instagram: '@perfil',
          facebook: 'perfil.facebook',
        }
      );
    }

    if (options.public) {
      await setDoc(doc(db, 'public_social_links', uid), {
        uid,
        instagram: '@perfil',
        facebook: 'perfil.facebook',
        updatedAt: new Date(),
      });
    }
  });
}

describe('Firestore Rules / social links subscription', () => {
  beforeAll(async () => {
    const rules = readFileSync(
      resolve(process.cwd(), 'firestore.rules'),
      'utf8'
    );

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedSubscription(SUBSCRIBER_UID, 'active');
    await seedSubscription(FREE_UID, 'inactive');
    await seedSubscription(EXPIRED_UID, 'expired');
    await seedSubscription(VISITOR_UID, 'inactive');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao assinante vigente criar fonte privada e espelho público', async () => {
    const db = authenticatedDb(SUBSCRIBER_UID);

    await assertSucceeds(
      setDoc(
        doc(
          db,
          'users',
          SUBSCRIBER_UID,
          'profileData',
          'socialLinks'
        ),
        { instagram: '@assinante' }
      )
    );

    await assertSucceeds(
      setDoc(doc(db, 'public_social_links', SUBSCRIBER_UID), {
        uid: SUBSCRIBER_UID,
        instagram: '@assinante',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega criação ou alteração para conta sem assinatura', async () => {
    const db = authenticatedDb(FREE_UID);

    await assertFails(
      setDoc(
        doc(db, 'users', FREE_UID, 'profileData', 'socialLinks'),
        { instagram: '@gratuito' }
      )
    );

    await seedSocialLinks(FREE_UID);

    await assertFails(
      updateDoc(
        doc(db, 'users', FREE_UID, 'profileData', 'socialLinks'),
        { instagram: '@alterado' }
      )
    );

    await assertFails(
      updateDoc(doc(db, 'public_social_links', FREE_UID), {
        instagram: '@alterado',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('nega flags ativas quando a janela temporal já expirou', async () => {
    const ownerDb = authenticatedDb(EXPIRED_UID);

    await assertFails(
      setDoc(
        doc(ownerDb, 'users', EXPIRED_UID, 'profileData', 'socialLinks'),
        { instagram: '@expirado' }
      )
    );

    await seedSocialLinks(EXPIRED_UID, { private: false, public: true });
    const visitorDb = authenticatedDb(VISITOR_UID);

    await assertFails(
      getDoc(doc(visitorDb, 'public_social_links', EXPIRED_UID))
    );
  });

  it('nega projeção legada sem versão e período canônicos', async () => {
    const legacyUid = 'social-legacy';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', legacyUid), {
        uid: legacyUid,
        isSubscriber: true,
        subscriptionStatus: 'active',
      });
    });

    const db = authenticatedDb(legacyUid);

    await assertFails(
      setDoc(
        doc(db, 'users', legacyUid, 'profileData', 'socialLinks'),
        { instagram: '@legado' }
      )
    );
  });

  it('permite ao dono remover links após o término da assinatura', async () => {
    await seedSocialLinks(FREE_UID);
    const db = authenticatedDb(FREE_UID);

    await assertSucceeds(
      updateDoc(
        doc(db, 'users', FREE_UID, 'profileData', 'socialLinks'),
        { instagram: deleteField() }
      )
    );

    await assertSucceeds(
      updateDoc(doc(db, 'public_social_links', FREE_UID), {
        instagram: deleteField(),
        updatedAt: serverTimestamp(),
      })
    );

    const privateSnapshot = await assertSucceeds(
      getDoc(
        doc(db, 'users', FREE_UID, 'profileData', 'socialLinks')
      )
    );

    expect(privateSnapshot.data()?.['instagram']).toBeUndefined();
  });

  it('permite ao dono excluir integralmente links após expiração', async () => {
    await seedSocialLinks(EXPIRED_UID);
    const db = authenticatedDb(EXPIRED_UID);

    await assertSucceeds(
      deleteDoc(
        doc(db, 'users', EXPIRED_UID, 'profileData', 'socialLinks')
      )
    );
    await assertSucceeds(
      deleteDoc(doc(db, 'public_social_links', EXPIRED_UID))
    );
  });

  it('permite ao visitante autenticado ler redes de perfil vigente', async () => {
    await seedSocialLinks(SUBSCRIBER_UID, {
      private: false,
      public: true,
    });
    const db = authenticatedDb(VISITOR_UID);

    const snapshot = await assertSucceeds(
      getDoc(doc(db, 'public_social_links', SUBSCRIBER_UID))
    );

    expect(snapshot.exists()).toBe(true);
    expect(snapshot.data()?.['instagram']).toBe('@perfil');
  });

  it('nega ao visitante redes de perfil sem assinatura', async () => {
    await seedSocialLinks(FREE_UID, {
      private: false,
      public: true,
    });
    const db = authenticatedDb(VISITOR_UID);

    await assertFails(
      getDoc(doc(db, 'public_social_links', FREE_UID))
    );
  });

  it('mantém leitura do próprio espelho para gerenciamento e limpeza', async () => {
    await seedSocialLinks(FREE_UID, {
      private: false,
      public: true,
    });
    const db = authenticatedDb(FREE_UID);

    const snapshot = await assertSucceeds(
      getDoc(doc(db, 'public_social_links', FREE_UID))
    );

    expect(snapshot.exists()).toBe(true);
  });

  it('nega leitura pública sem autenticação', async () => {
    await seedSocialLinks(SUBSCRIBER_UID, {
      private: false,
      public: true,
    });
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(
      getDoc(doc(db, 'public_social_links', SUBSCRIBER_UID))
    );
  });

  it('nega escrita em perfil alheio mesmo quando o alvo é assinante', async () => {
    const db = authenticatedDb(VISITOR_UID);

    await assertFails(
      setDoc(
        doc(
          db,
          'users',
          SUBSCRIBER_UID,
          'profileData',
          'socialLinks'
        ),
        { instagram: '@intruso' }
      )
    );

    await assertFails(
      setDoc(doc(db, 'public_social_links', SUBSCRIBER_UID), {
        uid: VISITOR_UID,
        instagram: '@intruso',
        updatedAt: serverTimestamp(),
      })
    );
  });
});
