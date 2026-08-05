// scripts/tests/video-staging-readiness.mjs
// -----------------------------------------------------------------------------
// Auditoria estática e segura do ambiente de homologação do pipeline de vídeos.
// Não acessa Google Cloud, Firebase ou dados de usuários.
//
// Modos:
// - padrão: prontidão de deploy, placeholders bloqueiam a execução real;
// - --contract: valida o contrato do repositório e converte pendências externas
//   conhecidas em warnings para permitir execução automática em pull requests.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CONTRACT_ONLY = process.argv.includes('--contract');
const REPORT_DIRECTORY = path.resolve(
  process.env.VIDEO_STAGING_REPORT_DIR || 'artifacts/video-staging'
);
const REPORT_PATH = path.join(REPORT_DIRECTORY, 'readiness.json');

const results = [];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function record(status, code, message, details = null) {
  results.push({ status, code, message, details });

  const marker = status === 'PASS' ? '✔' : status === 'WARN' ? '⚠' : '✖';
  console.log(`${marker} [${code}] ${message}`);

  if (details) {
    console.log(
      `  ${typeof details === 'string' ? details : JSON.stringify(details)}`
    );
  }
}

function check(condition, code, successMessage, failureMessage, details = null) {
  record(
    condition ? 'PASS' : 'FAIL',
    code,
    condition ? successMessage : failureMessage,
    details
  );
}

function warn(condition, code, successMessage, warningMessage, details = null) {
  record(
    condition ? 'PASS' : 'WARN',
    code,
    condition ? successMessage : warningMessage,
    details
  );
}

function deployCheck(
  condition,
  code,
  successMessage,
  failureMessage,
  details = null
) {
  if (CONTRACT_ONLY) {
    warn(condition, code, successMessage, failureMessage, details);
    return;
  }

  check(condition, code, successMessage, failureMessage, details);
}

function includesAll(text, values) {
  return values.every((value) => text.includes(value));
}

function extractQuotedValue(text, property) {
  const pattern = new RegExp(`${property}\\s*:\\s*['\"]([^'\"]+)['\"]`);
  return text.match(pattern)?.[1] ?? '';
}

function hasCompositeIndex(indexes, collectionGroup, orderedFields) {
  return indexes.some((index) => {
    if (
      index.collectionGroup !== collectionGroup ||
      !Array.isArray(index.fields) ||
      index.fields.length !== orderedFields.length
    ) {
      return false;
    }

    return orderedFields.every((expected, position) => {
      const field = index.fields[position] ?? {};
      return field.fieldPath === expected.fieldPath &&
        field.order === expected.order;
    });
  });
}

function hasTtlOverride(fieldOverrides, collectionGroup) {
  return fieldOverrides.some((override) =>
    override.collectionGroup === collectionGroup &&
    override.fieldPath === 'cleanupAfter' &&
    override.ttl === true &&
    Array.isArray(override.indexes) &&
    override.indexes.length === 0
  );
}

function run() {
  const mode = CONTRACT_ONLY ? 'contract' : 'deploy-readiness';
  console.log(
    `[video:staging:readiness] Iniciando auditoria estática (${mode}).`
  );

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  check(
    nodeMajor === 22,
    'NODE_RUNTIME',
    'Node 22 está ativo.',
    `Node 22 é obrigatório; runtime atual: ${process.versions.node}.`
  );

  const firebaseRc = readJson('.firebaserc');
  const defaultProject = String(firebaseRc.projects?.default ?? '').trim();
  const stagingProject = String(firebaseRc.projects?.staging ?? '').trim();

  check(
    !!stagingProject && stagingProject.toLowerCase().includes('staging'),
    'STAGING_ALIAS',
    `Alias staging aponta para ${stagingProject}.`,
    'O alias staging está ausente ou não identifica um projeto de homologação.'
  );
  check(
    !!defaultProject && stagingProject !== defaultProject,
    'PROJECT_ISOLATION',
    'Staging e produção usam projetos distintos.',
    'Staging não pode apontar para o mesmo projeto padrão/produção.',
    { defaultProject, stagingProject }
  );

  const stagingEnvironment = readText('src/environments/environment.staging.ts');
  const environmentProject = extractQuotedValue(stagingEnvironment, 'projectId');
  const environmentBucket = extractQuotedValue(stagingEnvironment, 'storageBucket');
  const appCheckSiteKey = extractQuotedValue(stagingEnvironment, 'siteKey');
  const apiEndpoint = extractQuotedValue(stagingEnvironment, 'apiEndpoint');

  check(
    environmentProject === stagingProject,
    'ANGULAR_PROJECT',
    'Configuração Angular usa o projeto de staging.',
    'O projectId do environment.staging.ts diverge do alias staging.',
    { environmentProject, stagingProject }
  );
  check(
    environmentBucket.startsWith(`${stagingProject}.`) &&
      environmentBucket.endsWith('.appspot.com'),
    'STAGING_BUCKET',
    `Bucket de staging configurado: ${environmentBucket}.`,
    'O bucket de staging não pertence ao projeto esperado ou não usa appspot.com.'
  );

  const hasRealAppCheckSiteKey = !!appCheckSiteKey &&
    !appCheckSiteKey.includes('staging-recaptcha-v3-site-key') &&
    !appCheckSiteKey.toLowerCase().includes('placeholder');
  deployCheck(
    hasRealAppCheckSiteKey,
    'APPCHECK_SITE_KEY',
    'App Check de staging possui site key não-placeholder.',
    CONTRACT_ONLY
      ? 'App Check continua placeholder; contrato válido, mas o smoke real permanece bloqueado.'
      : 'App Check de staging ainda usa uma site key placeholder. Homologação real deve permanecer bloqueada.'
  );
  warn(
    !!apiEndpoint && !apiEndpoint.includes('seuprojeto.com'),
    'STAGING_API_ENDPOINT',
    'Endpoint auxiliar de staging não é placeholder.',
    'O apiEndpoint de staging ainda é placeholder; não bloqueia o smoke de Firebase, mas bloqueia homologação integral do aplicativo.'
  );

  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['test:media:video:staging:readiness'] ===
      'node scripts/tests/video-staging-readiness.mjs',
    'READINESS_SCRIPT',
    'Comando de auditoria de staging está registrado.',
    'package.json não expõe o comando de auditoria de staging.'
  );
  check(
    packageJson.scripts?.['test:media:video:staging:smoke'] ===
      'npm run test:media:video:staging:readiness && node scripts/tests/video-staging-smoke.mjs',
    'SMOKE_SCRIPT',
    'Comando de smoke real está registrado.',
    'package.json não expõe o smoke test real de staging.'
  );

  const functionsRegion = readText('functions/src/config/functions-region.ts');
  check(
    functionsRegion.includes("FUNCTIONS_REGION = 'us-central1'"),
    'FUNCTIONS_REGION',
    'Região canônica das Functions é us-central1.',
    'A região canônica das Functions não é us-central1; revise o smoke e o IAM.'
  );

  const mediaIndex = readText('functions/src/media/index.ts');
  check(
    includesAll(mediaIndex, [
      'dispatchVideoProcessingOnJobWrite',
      'processVideoProcessingTask',
      'getVideoProcessingOperationalStatus',
      'listVideoProcessingRecoveryJobs',
      'recoverVideoProcessingJob',
    ]),
    'FUNCTION_EXPORTS',
    'Dispatcher, worker, diagnóstico e recuperação estão exportados.',
    'Um ou mais exports obrigatórios do pipeline não foram encontrados.'
  );

  const formatPolicy = readText(
    'src/app/core/services/media/video-upload-format.policy.ts'
  );
  check(
    includesAll(formatPolicy, [
      "mimeType: 'video/mp4'",
      "mimeType: 'video/quicktime'",
      "mimeType: 'video/webm'",
      "VIDEO_UPLOAD_FORMAT_LABEL = 'MP4, M4V, MOV ou WebM'",
    ]) &&
      !formatPolicy.includes("extension: 'mkv'") &&
      !formatPolicy.includes("extension: 'avi'"),
    'FORMAT_CONTRACT',
    'Contrato Angular anuncia somente MP4/M4V, MOV e WebM.',
    'O contrato Angular de formatos diverge do pipeline processável.'
  );

  const storageRules = readText('storage.rules');
  check(
    includesAll(storageRules, [
      "request.resource.contentType == 'video/mp4'",
      "request.resource.contentType == 'video/webm'",
      "request.resource.contentType == 'video/quicktime'",
      'request.resource.size <= 80 * 1024 * 1024',
      'reservedVideoUpload(',
      'allow update, delete: if false;',
    ]) &&
      !storageRules.includes("request.resource.contentType.matches('video/.*')"),
    'STORAGE_RULES',
    'Storage Rules exigem reserva, limite reduzido e MIME processável.',
    'Storage Rules ainda permitem formato amplo, arquivo excessivo, overwrite/delete ou upload sem reserva.'
  );

  const capacityReservationHandler = readText(
    'functions/src/media/application/private-video-upload-capacity.handler.ts'
  );
  const registerOrchestrator = readText(
    'functions/src/media/application/register-private-video-upload-orchestrator.handler.ts'
  );
  const effectiveRegistrationExport = includesAll(mediaIndex, [
    'registerPrivateVideoUpload,',
    "from './application/register-private-video-upload-orchestrator.handler';",
  ]);
  const effectiveReservationExport = includesAll(mediaIndex, [
    'getPrivateVideoUploadCapacity,',
    'reservePrivateVideoUpload,',
    "from './application/private-video-upload-capacity.handler';",
  ]);
  const reservationMimeBoundary = includesAll(capacityReservationHandler, [
    "'video/mp4'",
    "'video/webm'",
    "'video/quicktime'",
    'ALLOWED_VIDEO_TYPES.has(mimeType)',
    'getPrivateVideoProductLimit()',
    'sourceDurationMs',
    'evaluatePrivateVideoQuota(',
  ]) &&
    !capacityReservationHandler.includes("'video/x-matroska'") &&
    !capacityReservationHandler.includes("'video/x-msvideo'") &&
    !capacityReservationHandler.includes("'application/mxf'");
  const registrationReservationBoundary = includesAll(registerOrchestrator, [
    'reservationId?: string;',
    'assertPrivateVideoUploadReservation',
    'consumePrivateVideoUploadReservationAfterRegistration',
    'publishWhenReady: true',
    "from './register-private-video-upload.handler';",
  ]);

  check(
    effectiveRegistrationExport &&
      effectiveReservationExport &&
      reservationMimeBoundary &&
      registrationReservationBoundary,
    'REGISTER_CONTRACT',
    'Callables exportadas exigem capacidade, reserva e registro canônicos para MP4, WebM e MOV.',
    'A capacidade, a reserva, o registro ou seus exports públicos divergem do contrato efetivo.'
  );

  const indexesJson = readJson('firestore.indexes.json');
  const indexes = Array.isArray(indexesJson.indexes) ? indexesJson.indexes : [];
  const fieldOverrides = Array.isArray(indexesJson.fieldOverrides)
    ? indexesJson.fieldOverrides
    : [];

  check(
    hasTtlOverride(fieldOverrides, 'media_video_processing_dispatches') &&
      hasTtlOverride(fieldOverrides, 'media_video_processing_dead_letters'),
    'FIRESTORE_TTL_SCHEMA',
    'TTL de despachos e DLQ está versionado com indexação desabilitada.',
    'As duas políticas TTL cleanupAfter não estão integralmente versionadas.'
  );
  check(
    hasCompositeIndex(indexes, 'admin_logs', [
      { fieldPath: 'action', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ]),
    'ADMIN_AUDIT_INDEX',
    'Índice da timeline administrativa está versionado.',
    'O índice composto de admin_logs necessário ao painel não foi encontrado.'
  );

  const runbook = readText('docs/video-processing-runbook.md');
  check(
    includesAll(runbook, [
      'cloudtasks.googleapis.com',
      'roles/cloudtasks.enqueuer',
      'roles/cloudfunctions.invoker',
      'cleanupAfter',
      'processVideoProcessingTask',
    ]),
    'OPERATIONS_RUNBOOK',
    'Runbook contém APIs, IAM, TTL e worker.',
    'O runbook operacional está incompleto para homologação.'
  );

  const smokeScript = readText('scripts/tests/video-staging-smoke.mjs');
  check(
    includesAll(smokeScript, [
      "assert.notEqual(\n    projectId,\n    'entretenimento-sexual'",
      'VIDEO_STAGING_CONFIRM',
      'CustomProvider',
      'initializeAppCheck',
      'getAdminAppCheck',
      'adminAppCheck.createToken',
      'getVideoProcessingOperationalStatus',
      'validateOperationalPanel(observer, report)',
      'cleanupOwnerResources',
      "result.dispatchStates.includes('COMPLETED')",
    ]),
    'SMOKE_SAFETY_CONTRACT',
    'Smoke protege produção, usa App Check, valida o painel antes da limpeza e exige despacho concluído.',
    'As proteções, o App Check ou os critérios essenciais do smoke foram removidos.'
  );

  const workflow = readText('.github/workflows/video-staging-smoke.yml');
  check(
    includesAll(workflow, [
      'workflow_dispatch:',
      'environment: video-staging',
      'id-token: write',
      'google-github-actions/auth@v3',
      'confirm_project:',
      'VIDEO_STAGING_CONFIRM: ${{ inputs.confirm_project }}',
      'actions/upload-artifact@v7',
    ]) &&
      !workflow.includes('on:\n  push:') &&
      !workflow.includes('on:\n  pull_request:'),
    'MANUAL_WORKFLOW_CONTRACT',
    'Workflow real é manual, protegido por environment e autenticado via OIDC.',
    'O workflow real perdeu proteção manual, environment ou autenticação OIDC.'
  );

  const gitignore = readText('.gitignore');
  check(
    gitignore.includes('gha-creds-*.json') &&
      gitignore.includes('/artifacts/video-staging/'),
    'TEMPORARY_ARTIFACT_IGNORE',
    'Credenciais OIDC e relatórios locais estão ignorados.',
    'Credenciais temporárias ou relatórios locais podem entrar no repositório.'
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    deploymentReady: results.every((item) => item.status === 'PASS'),
    project: {
      defaultProject,
      stagingProject,
      environmentProject,
      environmentBucket,
    },
    totals: {
      pass: results.filter((item) => item.status === 'PASS').length,
      warn: results.filter((item) => item.status === 'WARN').length,
      fail: results.filter((item) => item.status === 'FAIL').length,
    },
    results,
  };

  fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`[video:staging:readiness] Relatório: ${REPORT_PATH}`);
  console.log(
    `[video:staging:readiness] PASS=${summary.totals.pass} ` +
      `WARN=${summary.totals.warn} FAIL=${summary.totals.fail}`
  );

  if (summary.totals.fail > 0) {
    process.exitCode = 1;
  }
}

try {
  run();
} catch (error) {
  console.error('[video:staging:readiness] Falha inesperada.', error);
  process.exitCode = 1;
}
