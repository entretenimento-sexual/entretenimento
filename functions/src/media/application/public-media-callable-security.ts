import { HttpsError } from 'firebase-functions/v2/https';

interface FirebaseRuntimeConfigLike {
  projectId?: unknown;
  project_id?: unknown;
}

export interface PublicMediaAppCheckEnvironment {
  functionsEmulator?: unknown;
  gcloudProject?: unknown;
  gcpProject?: unknown;
  firebaseConfig?: unknown;
}

const STAGING_FIREBASE_PROJECT_ID = 'entretenimento-staging';

function resolveRuntimeProjectId(
  environment: PublicMediaAppCheckEnvironment
): string {
  const directProjectId = String(
    environment.gcloudProject ?? environment.gcpProject ?? ''
  ).trim();

  if (directProjectId) {
    return directProjectId;
  }

  try {
    const firebaseConfig = JSON.parse(
      String(environment.firebaseConfig ?? '{}')
    ) as FirebaseRuntimeConfigLike;

    return String(
      firebaseConfig.projectId ?? firebaseConfig.project_id ?? ''
    ).trim();
  } catch {
    return '';
  }
}

export function shouldRequirePublicMediaAppCheck(
  environment: PublicMediaAppCheckEnvironment
): boolean {
  return environment.functionsEmulator !== 'true' &&
    resolveRuntimeProjectId(environment) !== STAGING_FIREBASE_PROJECT_ID;
}

export const REQUIRE_PUBLIC_MEDIA_APP_CHECK =
  shouldRequirePublicMediaAppCheck({
    functionsEmulator: process.env.FUNCTIONS_EMULATOR,
    gcloudProject: process.env.GCLOUD_PROJECT,
    gcpProject: process.env.GCP_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
  });

export function assertPublicMediaCallableAppCheck(
  appContext: unknown
): void {
  if (!REQUIRE_PUBLIC_MEDIA_APP_CHECK || appContext) {
    return;
  }

  throw new HttpsError(
    'unauthenticated',
    'Não foi possível verificar a origem desta solicitação.'
  );
}
