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
const VISITOR_UID = 'social-visitor';

let testEnv: RulesTestEnvironment;

function authenticatedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function seedSubscription(
  uid: string,
  active: boolean
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      uid,
      isSubscriber: active,
      subscriptionStatus: active ? 'active' : 'inactive',
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
    await seedSubscription(SUBSCRIBER_UID, true);
    await seedSubscription(FREE_UID, false);
    await seedSubscription(VISITOR_UID, false);
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite ao assinante criar a fonte privada e o espelho público', async () => {
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

  it('nega criação ou alteração de redes para conta sem assinatura', async () => {
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

  it('permite ao dono remover links mesmo após o término da assinatura', async () => {
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

  it('permite ao dono excluir integralmente seus links após expiração', async () => {
    await seedSocialLinks(FREE_UID);
    const db = authenticatedDb(FREE_UID);

    await assertSucceeds(
      deleteDoc(
        doc(db, 'users', FREE_UID, 'profileData', 'socialLinks')
      )
    );
    await assertSucceeds(
      deleteDoc(doc(db, 'public_social_links', FREE_UID))
    );
  });

  it('permite ao visitante autenticado ler redes de perfil assinante', async () => {
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

  it('nega ao visitante redes de perfil sem assinatura ativa', async () => {
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
