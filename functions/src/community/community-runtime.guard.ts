// functions/src/community/community-runtime.guard.ts
// -----------------------------------------------------------------------------
// COMMUNITY PREVIEW RUNTIME GUARD
// -----------------------------------------------------------------------------
// Define em quais runtimes o backend de Comunidades pode executar enquanto a
// feature ainda está em homologação controlada.
//
// - Emulator: permitido para desenvolvimento local;
// - projeto Firebase de staging: permitido para homologação real;
// - produção e runtime desconhecido: bloqueados (fail closed).
//
// Esta fronteira é independente de App Check e da feature flag do frontend.
// Staging continua exigindo App Check e `communityPreview` pode permanecer
// desligado até a homologação estar pronta para usuários selecionados.
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

  return resolveCommunityRuntimeProjectId(environment)
    === COMMUNITY_STAGING_PROJECT_ID;
}

export function isCommunityPreviewRuntimeAvailable(): boolean {
  return isCommunityPreviewRuntimeAllowed({
    functionsEmulator: process.env.FUNCTIONS_EMULATOR,
    gcloudProject: process.env.GCLOUD_PROJECT,
    gcpProject: process.env.GCP_PROJECT,
    firebaseConfig: process.env.FIREBASE_CONFIG,
  });
}
