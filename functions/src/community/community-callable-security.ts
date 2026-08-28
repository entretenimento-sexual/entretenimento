// functions/src/community/community-callable-security.ts
// -----------------------------------------------------------------------------
// COMMUNITY CALLABLE SECURITY
// -----------------------------------------------------------------------------
// Centraliza a exigência de App Check para callables de Comunidades.
//
// Estratégia de rollout:
// - Emulator: App Check dispensado para preservar o desenvolvimento local;
// - staging: temporariamente dispensado enquanto a feature permanece fechada e
//   a configuração real de App Check não estiver pronta;
// - produção e runtime desconhecido: App Check obrigatório (fail closed).
//
// Os guards de preview continuam sendo uma fronteira independente. Esta política
// prepara as callables para o rollout futuro, mas não habilita Comunidades fora
// dos ambientes já autorizados.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

interface FirebaseRuntimeConfigLike {
  projectId?: unknown;
  project_id?: unknown;
}

export interface CommunityAppCheckEnvironment {
  functionsEmulator?: unknown;
  gcloudProject?: unknown;
  gcpProject?: unknown;
  firebaseConfig?: unknown;
}

const STAGING_FIREBASE_PROJECT_ID = 'entretenimento-staging';

function resolveRuntimeProjectId(
  environment: CommunityAppCheckEnvironment
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

export function shouldRequireCommunityAppCheck(
  environment: CommunityAppCheckEnvironment
): boolean {
  return environment.functionsEmulator !== 'true'
    && resolveRuntimeProjectId(environment) !== STAGING_FIREBASE_PROJECT_ID;
}

export const REQUIRE_COMMUNITY_APP_CHECK = shouldRequireCommunityAppCheck({
  functionsEmulator: process.env.FUNCTIONS_EMULATOR,
  gcloudProject: process.env.GCLOUD_PROJECT,
  gcpProject: process.env.GCP_PROJECT,
  firebaseConfig: process.env.FIREBASE_CONFIG,
});

export function assertCommunityCallableAppCheck(appContext: unknown): void {
  if (!REQUIRE_COMMUNITY_APP_CHECK || appContext) {
    return;
  }

  throw new HttpsError(
    'unauthenticated',
    'Não foi possível verificar a origem desta solicitação.'
  );
}
