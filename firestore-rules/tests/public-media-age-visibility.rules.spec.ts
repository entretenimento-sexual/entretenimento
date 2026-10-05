import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
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
const OWNER_UID = 'media-age-owner';
const VIEWER_UID = 'media-age-viewer';
const VIDEO_ID = 'age-video';
const PHOTO_ID = 'age-photo';

let testEnv: RulesTestEnvironment;

function viewerDb() {
  return testEnv.authenticatedContext(VIEWER_UID).firestore();
}

async function setViewerCompliance(
  overrides: Record<string, unknown> = {}
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', VIEWER_UID),
      {
        uid: VIEWER_UID,
        accountStatus: 'active',
        suspended: false,
        acceptedTerms: {
          accepted: true,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
        initialAdultConsentRequired: false,
        adultConsent: { accepted: true, version: 'v1' },
        ageReverification: { status: 'NONE' },
        ...overrides,
      }
    );
  });
}

async function seedPublicMedia(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      setDoc(doc(db, 'users', VIEWER_UID), {
        uid: VIEWER_UID,
        accountStatus: 'active',
        suspended: false,
        acceptedTerms: {
          accepted: true,
          version: 'v3',
          acknowledgedPrivacyNotice: true,
        },
        initialAdultConsentRequired: false,
        adultConsent: { accepted: true, version: 'v1' },
        ageReverification: { status: 'NONE' },
      }),
      setDoc(doc(db, 'users', OWNER_UID), {
        uid: OWNER_UID,
        accountStatus: 'active',
        suspended: false,
        publicVisibility: 'visible',
        loginAllowed: true,
      }),
      setDoc(doc(db, 'age_eligibility_records', VIEWER_UID), {
        uid: VIEWER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'INITIAL_VERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 10_000),
        expiresAt: null,
      }),
      setDoc(doc(db, 'age_eligibility_records', OWNER_UID), {
        uid: OWNER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'INITIAL_VERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 10_000),
        expiresAt: null,
      }),
      setDoc(doc(db, 'public_profiles', OWNER_UID), {
        uid: OWNER_UID,
        nickname: 'Perfil adulto',
        nicknameNormalized: 'perfil-adulto',
        role: 'free',
      }),
      setDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        ),
        {
          id: VIDEO_ID,
          ownerUid: OWNER_UID,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          score: 10,
          publishedAt: 1,
        }
      ),
      setDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        ),
        {
          id: PHOTO_ID,
          ownerUid: OWNER_UID,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          publishedAt: 1,
        }
      ),
    ]);
  });
}

async function setActiveBlock(
  blockerUid: string,
  targetUid: string
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'users', blockerUid, 'blocks', targetUid),
      {
        uid: targetUid,
        isBlocked: true,
        actorUid: blockerUid,
        updatedAt: new Date(),
      }
    );
  });
}

async function assertPublicSurfaceDeepLinksFail(): Promise<void> {
  const db = viewerDb();

  await assertFails(
    getDoc(doc(db, 'public_profiles', OWNER_UID))
  );
  await assertFails(
    getDoc(
      doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_photos',
        PHOTO_ID
      )
    )
  );
  await assertFails(
    getDoc(
      doc(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos',
        VIDEO_ID
      )
    )
  );
}

async function setOwnerCanonicalAgeExpiry(expiresAt: Date | null) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'age_eligibility_records', OWNER_UID),
      {
        uid: OWNER_UID,
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        verifiedAt: new Date(Date.now() - 10_000),
        expiresAt,
      }
    );
  });
}

async function setOwnerSelfDeclaredAdult(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'age_eligibility_records', OWNER_UID),
      {
        uid: OWNER_UID,
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        decidedAt: new Date(Date.now() - 1_000),
        verifiedAt: null,
        expiresAt: null,
      }
    );

    const db = context.firestore();
    await Promise.all([
      updateDoc(doc(db, 'public_profiles', OWNER_UID), {
        ageEligibilityAdultAccessAllowed: true,
        ageEligibilityVerifiedAdult: false,
      }),
      updateDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID),
        {
          ageEligibilityAdultAccessAllowed: true,
          ageEligibilityVerifiedAdult: false,
        }
      ),
      updateDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID),
        {
          ageEligibilityAdultAccessAllowed: true,
          ageEligibilityVerifiedAdult: false,
        }
      ),
    ]);
  });
}

async function setViewerSelfDeclaredAdult(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'age_eligibility_records', VIEWER_UID),
      {
        uid: VIEWER_UID,
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
        source: 'SELF_DECLARATION',
        method: 'SELF_DECLARATION',
        decidedAt: new Date(Date.now() - 1_000),
        verifiedAt: null,
        expiresAt: null,
      }
    );
  });
}

async function setOwnerAgeProjection(eligible: boolean) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      updateDoc(
        doc(db, 'public_profiles', OWNER_UID),
        {
          ageEligibilityAdultAccessAllowed: eligible,
          ageEligibilityVerifiedAdult: eligible,
        }
      ),
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        ),
        { ageEligibilityVerifiedAdult: eligible }
      ),
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        ),
        { ageEligibilityVerifiedAdult: eligible }
      ),
    ]);
  });
}

async function setMediaVisibility(visibility: 'PUBLIC' | 'PRIVATE') {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        ),
        { visibility }
      ),
      updateDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        ),
        { visibility }
      ),
    ]);
  });
}

async function setOwnerLifecycle(
  overrides: Record<string, unknown>
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(
      doc(context.firestore(), 'users', OWNER_UID),
      overrides
    );
  });
}

async function setMediaModerationStatus(
  moderationStatus: 'APPROVED' | 'PENDING_REVIEW' | 'FLAGGED' | 'HIDDEN'
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await Promise.all([
      updateDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID),
        { moderationStatus }
      ),
      updateDoc(
        doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID),
        { moderationStatus }
      ),
    ]);
  });
}

function dbRefVideo(db: ReturnType<typeof viewerDb>) {
  return doc(
    db,
    'public_profiles',
    OWNER_UID,
    'public_videos',
    VIDEO_ID
  );
}

describe('Firestore Rules / public media account and content visibility', () => {
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
    await seedPublicMedia();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('permite mídia pública quando a projeção do perfil existe', async () => {
    const db = viewerDb();

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('nega exposição quando o owner possui apenas autodeclaração', async () => {
    await setOwnerSelfDeclaredAdult();
    const db = viewerDb();

    await assertFails(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
    );
    await assertFails(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID))
    );
  });

  it('viewer autodeclarado não acessa superfícies adultas', async () => {
    await setViewerSelfDeclaredAdult();
    const db = viewerDb();

    await assertFails(
      getDoc(doc(db, 'public_profiles', OWNER_UID))
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
  });

  it('nega deep link de perfil, foto e vídeo quando o viewer bloqueia o proprietário', async () => {
    const db = viewerDb();

    await assertSucceeds(getDoc(doc(db, 'public_profiles', OWNER_UID)));
    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
    );
    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID))
    );

    await setActiveBlock(VIEWER_UID, OWNER_UID);

    await assertPublicSurfaceDeepLinksFail();
  });

  it('nega deep link de perfil, foto e vídeo quando o proprietário bloqueia o viewer', async () => {
    const db = viewerDb();

    await assertSucceeds(getDoc(doc(db, 'public_profiles', OWNER_UID)));
    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
    );
    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID))
    );

    await setActiveBlock(OWNER_UID, VIEWER_UID);

    await assertPublicSurfaceDeepLinksFail();
  });

  it('permite deep link público e bloqueia quando o vídeo deixa de ser público', async () => {
    const db = viewerDb();
    const videoRef = doc(
      db,
      'public_profiles',
      OWNER_UID,
      'public_videos',
      VIDEO_ID
    );

    await assertSucceeds(getDoc(videoRef));

    await setMediaVisibility('PRIVATE');

    await assertFails(getDoc(videoRef));
  });

  it('revoga mídia quando a assurance confiável do owner vence', async () => {
    await setOwnerCanonicalAgeExpiry(new Date(Date.now() - 1_000));
    const db = viewerDb();

    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('revoga deep link de foto e vídeo imediatamente quando o proprietário é suspenso', async () => {
    const db = viewerDb();

    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
    );
    await assertSucceeds(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID))
    );

    await setOwnerLifecycle({
      accountStatus: 'moderation_suspended',
      suspended: true,
      publicVisibility: 'hidden',
      loginAllowed: false,
    });

    await assertFails(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
    );
    await assertFails(
      getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_videos', VIDEO_ID))
    );
  });

  it('mantém mídia em quarentena fora de deep link para foto e vídeo', async () => {
    const db = viewerDb();

    for (const moderationStatus of [
      'PENDING_REVIEW',
      'FLAGGED',
      'HIDDEN',
    ] as const) {
      await setMediaModerationStatus(moderationStatus);

      await assertFails(
        getDoc(doc(db, 'public_profiles', OWNER_UID, 'public_photos', PHOTO_ID))
      );
      await assertFails(
        getDoc(dbRefVideo(db))
      );

      await setMediaModerationStatus('APPROVED');
    }
  });

  it('bloqueia acesso direto quando o perfil pai foi ocultado', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'public_profiles', OWNER_UID));
    });
    const db = viewerDb();

    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('nega qualquer listagem client-side de mídia pública e mantém deep links documentais', async () => {
    const db = viewerDb();
    const globalVideoQuery = query(
      collectionGroup(db, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const globalPhotoQuery = query(
      collectionGroup(db, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertFails(getDocs(globalVideoQuery));
    await assertFails(getDocs(globalPhotoQuery));

    const ownerVideoQuery = query(
      collection(
        db,
        'public_profiles',
        OWNER_UID,
        'public_videos'
      ),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const ownerPhotoQuery = query(
      collection(
        db,
        'public_profiles',
        OWNER_UID,
        'public_photos'
      ),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertFails(getDocs(ownerVideoQuery));
    await assertFails(getDocs(ownerPhotoQuery));

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );
  });

  it('mantém listagem owner-scoped bloqueada após restauração para PUBLIC', async () => {
    await setMediaVisibility('PRIVATE');
    await setMediaVisibility('PUBLIC');
    const db = viewerDb();

    const videoQuery = query(
      collection(db, 'public_profiles', OWNER_UID, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const photoQuery = query(
      collection(db, 'public_profiles', OWNER_UID, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertFails(getDocs(videoQuery));
    await assertFails(getDocs(photoQuery));

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
  });

  it('ignora projeções etárias legadas do proprietário e mantém listagem client-side bloqueada', async () => {
    await setOwnerAgeProjection(false);
    const db = viewerDb();

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_photos',
          PHOTO_ID
        )
      )
    );

    const videoQuery = query(
      collectionGroup(db, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const photoQuery = query(
      collectionGroup(db, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertFails(getDocs(videoQuery));
    await assertFails(getDocs(photoQuery));

    const ownerVideoQuery = query(
      collection(db, 'public_profiles', OWNER_UID, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );
    const ownerPhotoQuery = query(
      collection(db, 'public_profiles', OWNER_UID, 'public_photos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertFails(getDocs(ownerVideoQuery));
    await assertFails(getDocs(ownerPhotoQuery));
  });

  it('reverificação etária não vira gate local de Media', async () => {
    await setViewerCompliance({
      ageReverification: { status: 'REQUIRED' },
    });
    const db = viewerDb();
    const videoQuery = query(
      collectionGroup(db, 'public_videos'),
      where('visibility', '==', 'PUBLIC'),
      where('moderationStatus', '==', 'APPROVED')
    );

    await assertSucceeds(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
    await assertFails(getDocs(videoQuery));
  });

  it('bloqueia mídia durante hold automático vigente e libera após expiração', async () => {
    const db = viewerDb();
    const videoRef = doc(
      db,
      'public_profiles',
      OWNER_UID,
      'public_videos',
      VIDEO_ID
    );

    await setViewerCompliance({
      moderationAutomationHold: {
        active: true,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await assertFails(getDoc(videoRef));

    await setViewerCompliance({
      moderationAutomationHold: {
        active: true,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await assertSucceeds(getDoc(videoRef));
  });

  it('bloqueia vídeo quando os termos do viewer estão desatualizados', async () => {
    await setViewerCompliance({
      acceptedTerms: {
        accepted: true,
        version: 'v2',
        acknowledgedPrivacyNotice: true,
      },
    });
    const db = viewerDb();

    await assertFails(
      getDoc(
        doc(
          db,
          'public_profiles',
          OWNER_UID,
          'public_videos',
          VIDEO_ID
        )
      )
    );
  });

  it('exige consentimento adulto vigente quando ele é obrigatório', async () => {
    await setViewerCompliance({
      initialAdultConsentRequired: true,
      adultConsent: null,
    });
    const db = viewerDb();
    const videoRef = doc(
      db,
      'public_profiles',
      OWNER_UID,
      'public_videos',
      VIDEO_ID
    );

    await assertFails(getDoc(videoRef));

    await setViewerCompliance({
      initialAdultConsentRequired: true,
      adultConsent: { accepted: true, version: 'v1' },
    });

    await assertSucceeds(getDoc(videoRef));
  });
});
