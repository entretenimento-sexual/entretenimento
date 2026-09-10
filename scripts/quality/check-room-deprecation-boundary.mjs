// scripts/quality/check-room-deprecation-boundary.mjs
// -----------------------------------------------------------------------------
// ROOM DEPRECATION BOUNDARY CHECK
// -----------------------------------------------------------------------------
// Salas são `deprecated_compatibility_only`. Este gate impede que o navegador volte
// a criar/aceitar membership, escrever mensagens/projeções/denúncias ou transformar
// Comunidades em dependentes do domínio legado. Leitura compatível, recusa de convite
// e encerramento continuam permitidos.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

const files = {
  management: path.join(root, 'src/app/core/services/batepapo/room-services/room-management.service.ts'),
  invites: path.join(root, 'src/app/core/services/batepapo/room-services/room-invite-flow.service.ts'),
  participants: path.join(root, 'src/app/core/services/batepapo/room-services/room-participants.service.ts'),
  userRoomIds: path.join(root, 'src/app/core/services/batepapo/room-services/user-room-ids.service.ts'),
  messages: path.join(root, 'src/app/core/services/batepapo/room-services/room-messages.service.ts'),
  reports: path.join(root, 'src/app/core/services/batepapo/room-services/room-reports.service.ts'),
  chatRoutes: path.join(root, 'src/app/chat-module/chat-module-routing.module.ts'),
  appRoutes: path.join(root, 'src/app/app-routing.module.ts'),
};

const violations = [];

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    violations.push(`${path.relative(root, filePath)}: arquivo canônico ausente.`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function forbid(filePath, pattern, message) {
  const source = read(filePath);
  if (pattern.test(source)) {
    violations.push(`${path.relative(root, filePath)}: ${message}`);
  }
}

function walkTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const filesFound = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      filesFound.push(...walkTypeScriptFiles(absolutePath));
    } else if (
      entry.isFile()
      && entry.name.endsWith('.ts')
      && !entry.name.endsWith('.spec.ts')
      && !entry.name.endsWith('.test.ts')
    ) {
      filesFound.push(absolutePath);
    }
  }
  return filesFound;
}

forbid(
  files.management,
  /['"]createPrivateRoom['"]/,
  'o cliente não pode voltar a chamar createPrivateRoom.'
);
forbid(
  files.invites,
  /['"]acceptRoomInvite['"]|['"]sendRoomInvite['"]/,
  'aceite/envio de convite legado não pode voltar ao cliente.'
);
forbid(
  files.participants,
  /\b(?:runTransaction|addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\s*\(/,
  'membership de Sala não pode ser mutado pelo navegador.'
);
forbid(
  files.userRoomIds,
  /(?:@angular\/fire\/firestore|firebase\/firestore)/,
  'users.roomIds é projeção legada e não pode ter I/O Firestore no cliente.'
);
forbid(
  files.messages,
  /(?:@angular\/fire\/firestore|firebase\/firestore)/,
  'mensagens de Sala estão fechadas para I/O do cliente.'
);
forbid(
  files.reports,
  /(?:@angular\/fire\/firestore|firebase\/firestore)/,
  'Salas legadas não podem receber novos reports pelo cliente.'
);
forbid(
  files.chatRoutes,
  /path\s*:\s*['"]rooms\//,
  'não criar rota dinâmica de conversa em /chat/rooms/:id.'
);
forbid(
  files.chatRoutes,
  /path\s*:\s*['"]messages(?:\/|['"])/,
  'não reintroduzir /chat/messages como superfície de Sala.'
);
forbid(
  files.appRoutes,
  /path\s*:\s*['"]messages(?:\/|['"])/,
  'não reintroduzir /messages no Router principal.'
);

const communityRoot = path.join(root, 'src/app/community');
for (const communityFile of walkTypeScriptFiles(communityRoot)) {
  const source = fs.readFileSync(communityFile, 'utf8');
  if (/room-services/.test(source)) {
    violations.push(
      `${path.relative(root, communityFile)}: Comunidades não podem depender de room-services.`
    );
  }
  if (
    /\b(?:collection|collectionGroup|doc)\s*\([\s\S]{0,180}?(?:['"]rooms['"]|['"]rooms\/)/m.test(source)
  ) {
    violations.push(
      `${path.relative(root, communityFile)}: Comunidades não podem usar rooms como autoridade Firestore.`
    );
  }
}

const uniqueViolations = [...new Set(violations)].sort();
if (uniqueViolations.length > 0) {
  console.error('[room-deprecation] Fronteira canônica de Salas violada:');
  for (const violation of uniqueViolations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[room-deprecation] Salas aceitam apenas compatibilidade de leitura, recusa de convite e encerramento. Membership/roles pertencem a Comunidades.'
  );
  process.exit(1);
}

console.log(
  '[room-deprecation] OK: Salas seguem congeladas e Comunidades permanecem independentes do legado.'
);
