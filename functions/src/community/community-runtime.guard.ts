// functions/src/community/community-runtime.guard.ts
// -----------------------------------------------------------------------------
// COMMUNITY RUNTIME GUARD
// -----------------------------------------------------------------------------
// Define em quais runtimes o backend de Comunidades pode executar.
//
// - Emulator: permitido para desenvolvimento local;
// - staging: permitido para homologação real;
// - produção: permitido para a experiência pública de Comunidades;
// - runtime desconhecido: bloqueado (fail closed).
//
// Esta fronteira continua independente de App Check, autenticação, autorização,
// quotas e feature flags do frontend. Os nomes "Preview" das funções públicas
// são preservados por compatibilidade enquanto o domínio entra em operação.
// -----------------------------------------------------------------------------

interface FirebaseRuntimeConfigLike {
  projectId?: unknown;
  project_id?: unknown;
}

export interface CommunityRuntimeEnvironment {
  functionsEmulator?: unknown;
  gcloudProject?: unknown;
  gcpProject?: unknown;
  firebaseConfig?: unknown;
}

export const COMMUNITY_STAGING_PROJECT_ID = 'entretenimento-staging';
export const COMMUNITY_PRODUCTION_PROJECT_ID = 'entretenimento-sexual';

const COMMUNITY_ALLOWED_PROJECT_IDS = new Set<string>([
  COMMUNITY_STAGING_PROJECT_ID,
  COMMUNITY_PRODUCTION_PROJECT_ID,
]);

export function resolveCommunityRuntimeProjectId(
  environment: CommunityRuntimeEnvironment
): string {
  const directProjectId = String(
    environment.gcloudProject ?? environment.gcpProject ?? ''
  ).trim();

  if (directProjectId) return directProjectId;

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

export function isCommunityPreviewRuntimeAllowed(
  environment: CommunityRuntimeEnvironment
): boolean {
  if (environment.functionsEmulator === 'true') return true;

  return COMMUNITY_ALLOWED_PROJECT_IDS.has(
    resolveCommunityRuntimeProjectId(environment)
  );
}

export function isCommunityPreviewRuntimeAvailable(): boolean {
  return isCommunityPreviewRuntimeAllowed({
    functionsEmulator: process.env.FUNCTIONS_EMULATOR,
    gcloudProject: process.env.GCLOUD_PROJECT,
    gcpProject: process.env.GCP_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
  });
}
