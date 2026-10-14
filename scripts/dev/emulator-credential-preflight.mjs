// Fail closed if Firebase emulators could inherit credentials for real cloud services.
// Only inspects environment variable names and known ADC file locations; never reads secrets.
import fs from 'node:fs';
import path from 'node:path';

const CREDENTIAL_ENV_KEYS = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_OAUTH_ACCESS_TOKEN',
  'GOOGLE_ACCESS_TOKEN',
  'GOOGLE_CLOUD_CREDENTIALS',
  'FIREBASE_TOKEN',
  'FIREBASE_CI_TOKEN',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultAdcDirectory(env, platform) {
  // Google Auth 9.x uses APPDATA/HOME for ADC, not CLOUDSDK_CONFIG.
  if (platform === 'win32') {
    if (nonEmpty(env.APPDATA)) return path.join(env.APPDATA, 'gcloud');
    if (nonEmpty(env.USERPROFILE)) return path.join(env.USERPROFILE, 'AppData', 'Roaming', 'gcloud');
    return null;
  }
  if (nonEmpty(env.HOME)) return path.join(env.HOME, '.config', 'gcloud');
  return null;
}

/** Returns credential source labels, never credential content or private paths. */
export function findEmulatorCredentialRisks({
  env = process.env,
  platform = process.platform,
  isFile = (filename) => {
    try {
      return fs.statSync(filename).isFile();
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  },
} = {}) {
  const risks = CREDENTIAL_ENV_KEYS
    .filter((key) => nonEmpty(env[key]))
    .map((key) => `variável ${key}`);
  const adcDir = defaultAdcDirectory(env, platform);
  if (adcDir) {
    let found;
    try {
      found = isFile(path.join(adcDir, 'application_default_credentials.json'));
    } catch {
      throw new Error('Falha ao verificar o arquivo ADC local; inicialização bloqueada.');
    }
    if (found) risks.push('arquivo ADC local do gcloud');
  }
  return risks;
}

export function assertEmulatorCredentialsIsolated(options) {
  const risks = findEmulatorCredentialRisks(options);
  if (risks.length > 0) {
    throw new Error(
      `Credenciais utilizáveis fora dos emuladores detectadas: ${risks.join(', ')}. ` +
      'Inicialização bloqueada antes de acessar dados locais. ' +
      'Use uma sessão sem tokens e isole APPDATA (Windows) ou HOME (Linux/macOS) ' +
      'no processo Firebase: CLOUDSDK_CONFIG sozinho não isola ADC. ' +
      'Não apague credenciais existentes nem use contas reais para contornar esta proteção.'
    );
  }
}

/** Make a Firebase CLI child environment with a fresh Windows APPDATA. */
export function isolateWindowsFirebaseCliEnvironment(env, isolatedDirectory) {
  if (typeof isolatedDirectory !== 'string' || !path.isAbsolute(isolatedDirectory)) {
    throw new Error('APPDATA temporário absoluto é obrigatório para isolar Firebase CLI.');
  }
  return {
    ...env,
    APPDATA: isolatedDirectory,
    CLOUDSDK_CONFIG: path.join(isolatedDirectory, 'gcloud-config'),
    XDG_CONFIG_HOME: path.join(isolatedDirectory, '.config'),
  };
}
