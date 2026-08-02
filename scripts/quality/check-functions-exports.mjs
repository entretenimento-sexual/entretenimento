// scripts/quality/check-functions-exports.mjs
// -----------------------------------------------------------------------------
// Verifica o artefato compilado que o Firebase Emulator realmente carrega.
//
// Objetivo:
// - impedir que um barrel TypeScript correto esconda um functions/lib obsoleto;
// - falhar antes de iniciar emuladores ou validar produção;
// - manter diagnóstico explícito para callables e triggers críticas de
//   mensageria, compliance, publicação e processamento obrigatório de mídia.
// -----------------------------------------------------------------------------
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entryPath = resolve(process.cwd(), 'functions', 'lib', 'index.js');
const requiredExports = [
  'createPrivateRoom',
  'closePrivateRoom',
  'sendRoomInvite',
  'acceptRoomInvite',
  'declineRoomInvite',
  'ensureDirectChat',
  'sendDirectMessage',
  'deleteDirectMessage',
  'acceptPlatformTerms',
  'ensureCurrentLegalNotice',
  'issueSuspectedViolationNotice',
  'getMyComplianceCases',
  'submitComplianceCaseResponse',
  'registerAndPublishPhotoUpload',
  'registerPrivateVideoUpload',
  'finalizeVideoProcessingVariants',
];

if (!existsSync(entryPath)) {
  console.error(
    '[functions:exports] functions/lib/index.js não existe. Execute npm run functions:build.'
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
let compiledFunctions;

try {
  compiledFunctions = require(entryPath);
} catch (error) {
  console.error(
    `[functions:exports] Não foi possível carregar ${pathToFileURL(entryPath).href}.`
  );
  console.error(error);
  process.exit(1);
}

const missingExports = requiredExports.filter(
  (exportName) => typeof compiledFunctions?.[exportName] !== 'function'
);

if (missingExports.length > 0) {
  console.error('[functions:exports] Exports públicos ausentes no artefato compilado:');
  for (const exportName of missingExports) {
    console.error(`- ${exportName}`);
  }
  console.error(
    '[functions:exports] O emulador não deve iniciar com Functions desatualizadas.'
  );
  process.exit(1);
}

console.log(
  `[functions:exports] OK: ${requiredExports.join(', ')}`
);
