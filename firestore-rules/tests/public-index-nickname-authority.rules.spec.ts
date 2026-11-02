// Firestore Rules: a reserva de nickname não pode ser um cadastro de aliases.
// Dados exclusivamente sintéticos, no Firestore Emulator; não usa produção.
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
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const USER_ID = 'nickname-owner';
const PROJECT_ID = 'demo-entretenimento-nickname-index-rules';
let environment: RulesTestEnvironment;

function ownerDb() {
  return environment.authenticatedContext(USER_ID, {
    email_verified: true,
  }).firestore();
}

function indexPayload(value = 'perfil_estavel') {
  return {
    uid: USER_ID,
    type: 'nickname',
    value,
    createdAt: serverTimestamp(),
    lastChangedAt: serverTimestamp(),
  };
}

async function seed(ownerVisibility = 'visible'): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, 'users', USER_ID), {
      uid: USER_ID,
      nickname: 'Perfil Estavel',
      nicknameNormalized: 'perfil_estavel',
      accountStatus: 'active',
      profileCompleted: true,
      publicVisibility: ownerVisibility,
      interactionBlocked: false,
      loginAllowed: true,
      emailVerified: true,
      initialAdultConsentRequired: true,
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: 'v1' },
    });
    await setDoc(doc(database, 'public_profiles', USER_ID), {
      uid: USER_ID,
      nickname: 'Perfil Estavel',
      nicknameNormalized: 'perfil_estavel',
      publicVisibility: ownerVisibility,
    });
  });
}

describe('Firestore Rules / autoridade da reserva de nickname', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8180,
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
  });

  beforeEach(async () => environment.clearFirestore());
  afterAll(async () => environment.cleanup());

  it('permite criar somente a chave que corresponde à projeção do titular', async () => {
    await seed();
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      indexPayload()
    ));
  });

  it('nega aliases avulsos, valores divergentes e tipo incompatível', async () => {
    await seed();
    await assertFails(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:apelido_extra'),
      indexPayload('apelido_extra')
    ));
    await assertFails(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      indexPayload('apelido_extra')
    ));
    await assertFails(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      { ...indexPayload(), type: 'email' }
    ));
    await assertFails(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      { ...indexPayload(), uid: 'outro-usuario' }
    ));
  });

  it('não reserva apelido de perfil oculto mesmo que a projeção exista', async () => {
    await seed('hidden');
    await assertFails(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      indexPayload()
    ));
  });

  it('nega remoção client-side de nickname já reservado', async () => {
    await seed();
    await assertSucceeds(setDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel'),
      indexPayload()
    ));
    await assertFails(deleteDoc(
      doc(ownerDb(), 'public_index', 'nickname:perfil_estavel')
    ));
  });

  it('não altera a capacidade legada do titular de retirar índice privado de email', async () => {
    await seed();
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'public_index', 'email:hash-sintetico'), {
        uid: USER_ID, type: 'email', value: 'hash-sintetico',
        createdAt: new Date(), lastChangedAt: new Date(),
      });
    });
    await assertSucceeds(deleteDoc(
      doc(ownerDb(), 'public_index', 'email:hash-sintetico')
    ));
  });
});
