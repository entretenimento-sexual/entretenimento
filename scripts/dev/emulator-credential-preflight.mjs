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
  if (nonEmpty(env.CLOUDSDK_CONFIG)) return env.CLOUDSDK_CONFIG;
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
      'Execute com variáveis de credenciais removidas desta sessão e CLOUDSDK_CONFIG ' +
      'apontando para uma pasta vazia e exclusiva do emulador. ' +
      'Não apague credenciais existentes nem use contas reais para contornar esta proteção.'
    );
  }
}
