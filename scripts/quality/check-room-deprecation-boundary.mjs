// scripts/quality/check-room-deprecation-boundary.mjs
// -----------------------------------------------------------------------------
// ROOM DEPRECATION BOUNDARY CHECK
// -----------------------------------------------------------------------------
// Salas são `deprecated_compatibility_only`.
//
// Contrato estrutural:
// - /chat/rooms é a ÚNICA superfície Angular legada permitida;
// - essa tela pode somente consultar registros históricos e encerrá-los;
// - não existe RoomsModule carregado, rotas create/:id, componentes de conversa,
//   modais de criação, inbox de convites ou caminho de envio `room` no ChatModule;
// - Comunidades permanecem independentes do domínio legado;
// - os diretórios produtivos de Room existentes ficam congelados: correções e
//   limpeza alteram arquivos existentes, mas não abrem nova superfície;
// - não pode surgir domínio/helper compartilhado que acople Community e Room;
// - a remoção final não tem prazo fixo e exige evidência de uso residual.
//
// Contrato de dados:
// - leitura histórica, recusa/encerramento server-side e retenção continuam
//   permitidos enquanto existirem documentos legados;
// - criação, aceite/membership, mensagens, reports e projeções não voltam ao
//   navegador.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

const files = {
  management: path.join(
    root,
    'src/app/core/services/batepapo/room-services/room-management.service.ts'
  ),
  invites: path.join(
    root,
    'src/app/core/services/batepapo/room-services/room-invite-flow.service.ts'
  ),
  participants: path.join(
    root,
    'src/app/core/services/batepapo/room-services/room-participants.service.ts'
  ),
  userRoomIds: path.join(
    root,
    'src/app/core/services/batepapo/room-services/user-room-ids.service.ts'
  ),
  messages: path.join(
    root,
    'src/app/core/services/batepapo/room-services/room-messages.service.ts'
  ),
  reports: path.join(
    root,
    'src/app/core/services/batepapo/room-services/room-reports.service.ts'
  ),
  chatRoutes: path.join(
    root,
    'src/app/chat-module/chat-module-routing.module.ts'
  ),
  chatModule: path.join(
    root,
    'src/app/chat-module/chat-module.ts'
  ),
  chatLayoutTs: path.join(
    root,
    'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
  ),
  chatLayoutHtml: path.join(
    root,
    'src/app/chat-module/chat-module-layout/chat-module-layout.component.html'
  ),
  chatList: path.join(
    root,
    'src/app/chat-module/chat-list/chat-list.component.ts'
  ),
  chatRooms: path.join(
    root,
    'src/app/chat-module/chat-rooms/chat-rooms.component.ts'
  ),
  appRoutes: path.join(root, 'src/app/app-routing.module.ts'),
  layoutShell: path.join(
    root,
    'src/app/layout/layout-shell/layout-shell.component.ts'
  ),
  storeModule: path.join(root, 'src/app/store/store.module.ts'),
  compatibilityPolicy: path.join(
    root,
    'src/app/core/domain/room-compatibility.policy.ts'
  ),
};

const retiredPaths = [
  'src/app/chat-module/rooms',
  'src/app/chat-module/modals/create-room-modal',
  'src/app/chat-module/modals/room-create-confirm-modal',
  'src/app/chat-module/invite-list',
];

const frozenRoomProductionRoots = [
  'functions/src/chat/rooms',
  'src/app/chat-module/chat-rooms',
  'src/app/core/services/batepapo/room-services',
];

const frozenRoomProductionFiles = new Set([
  'functions/src/chat/rooms/application/close-private-room.handler.ts',
  'functions/src/chat/rooms/application/create-private-room.handler.ts',
  'functions/src/chat/rooms/application/respond-room-invite.handler.ts',
  'functions/src/chat/rooms/application/send-room-invite.handler.ts',
  'functions/src/chat/rooms/domain/room-capability-policy.ts',
  'functions/src/chat/rooms/domain/room-deprecation.policy.ts',
  'functions/src/chat/rooms/index.ts',
  'src/app/chat-module/chat-rooms/chat-rooms.clean.css',
  'src/app/chat-module/chat-rooms/chat-rooms.component.css',
  'src/app/chat-module/chat-rooms/chat-rooms.component.html',
  'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
  'src/app/core/services/batepapo/room-services/room-firestore.gateway.ts',
  'src/app/core/services/batepapo/room-services/room-invite-flow.service.ts',
  'src/app/core/services/batepapo/room-services/room-management.service.ts',
  'src/app/core/services/batepapo/room-services/room-messages.service.ts',
  'src/app/core/services/batepapo/room-services/room-participants.service.ts',
  'src/app/core/services/batepapo/room-services/room-reports.service.ts',
  'src/app/core/services/batepapo/room-services/room.service.ts',
  'src/app/core/services/batepapo/room-services/user-room-ids.service.ts',
]);

const violations = [];

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    violations.push(`${relative(filePath)}: arquivo canônico ausente.`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function forbid(filePath, pattern, message) {
  const source = read(filePath);
  if (pattern.test(source)) {
    violations.push(`${relative(filePath)}: ${message}`);
  }
}

function requireMatch(filePath, pattern, message) {
  const source = read(filePath);
  if (!pattern.test(source)) {
    violations.push(`${relative(filePath)}: ${message}`);
  }
}

function forbidPath(relativePath, message) {
  const absolutePath = path.join(root, relativePath);
  if (fs.existsSync(absolutePath)) {
    violations.push(`${relativePath}: ${message}`);
  }
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const filesFound = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      filesFound.push(...walkFiles(absolutePath));
      continue;
    }

    if (entry.isFile()) filesFound.push(absolutePath);
  }

  return filesFound;
}

function isTestTypeScript(filePath) {
  return filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts');
}

function walkTypeScriptFiles(directory) {
  return walkFiles(directory).filter(
    (filePath) =>
      filePath.endsWith('.ts')
      && !isTestTypeScript(filePath)
  );
}

function importedSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1] ?? '');
  }

  return specifiers;
}

function hasImportMatching(source, pattern) {
  return importedSpecifiers(source).some((specifier) => pattern.test(specifier));
}

// -----------------------------------------------------------------------------
// Freeze estrutural: Room não ganha novos arquivos produtivos
// -----------------------------------------------------------------------------

for (const frozenRoot of frozenRoomProductionRoots) {
  const absoluteRoot = path.join(root, frozenRoot);

  for (const filePath of walkFiles(absoluteRoot)) {
    if (isTestTypeScript(filePath)) continue;

    const relativePath = relative(filePath);

    if (!frozenRoomProductionFiles.has(relativePath)) {
      violations.push(
        `${relativePath}: novo arquivo produtivo de Room não é permitido durante o congelamento.`
      );
    }
  }
}

requireMatch(
  files.compatibilityPolicy,
  /newFeaturesAllowed\s*:\s*false/,
  'o contrato canônico deve manter novas features de Room bloqueadas.'
);

requireMatch(
  files.compatibilityPolicy,
  /sharedDomainWithCommunityAllowed\s*:\s*false/,
  'Room não pode ganhar domínio compartilhado com Community.'
);

requireMatch(
  files.compatibilityPolicy,
  /strategy\s*:\s*['"]residual_usage_evidence['"][\s\S]{0,240}?scheduledRemovalAt\s*:\s*null/m,
  'a remoção de Room deve permanecer sem data fixa e guiada por evidência residual.'
);

// -----------------------------------------------------------------------------
// Backend/client deprecation boundary
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Única rota legada permitida
// -----------------------------------------------------------------------------

requireMatch(
  files.chatRoutes,
  /path\s*:\s*['"]rooms['"][\s\S]{0,180}?component\s*:\s*ChatRoomsComponent/m,
  '/chat/rooms deve permanecer apontando diretamente para ChatRoomsComponent enquanto houver legado.'
);

forbid(
  files.chatRoutes,
  /path\s*:\s*['"]rooms\//,
  'não criar rota dinâmica sob /chat/rooms.'
);

forbid(
  files.chatRoutes,
  /path\s*:\s*['"](?:room-invites|invite-list|messages)(?:\/|['"])/,
  'não reintroduzir rotas legadas de convite/mensagem de Sala.'
);

forbid(
  files.appRoutes,
  /path\s*:\s*['"]messages(?:\/|['"])/,
  'não reintroduzir /messages no Router principal.'
);

for (const retiredPath of retiredPaths) {
  forbidPath(
    retiredPath,
    'superfície Angular de Sala aposentada não pode reaparecer.'
  );
}

// -----------------------------------------------------------------------------
// ChatModule deve permanecer direct-chat + /chat/rooms read/close only
// -----------------------------------------------------------------------------

forbid(
  files.chatModule,
  /(?:import\s*\{\s*RoomsModule\s*\}|\bRoomsModule\s*,)/,
  'RoomsModule não pode voltar ao caminho carregado.'
);

forbid(
  files.chatModule,
  /(?:CreateRoomModalComponent|RoomCreationConfirmationModalComponent|RoomInteractionComponent|InviteListComponent)/,
  'componentes/modais aposentados de Sala não podem voltar ao ChatModule.'
);

forbid(
  files.chatModule,
  /from\s*['"][^'"]*(?:\/rooms\/|create-room-modal|room-create-confirm-modal|invite-list\/invite-list\.component)[^'"]*['"]/,
  'ChatModule não pode importar a superfície Angular aposentada de Salas.'
);

// -----------------------------------------------------------------------------
// ChatModuleLayout não pode voltar a selecionar/renderizar/enviar para room
// -----------------------------------------------------------------------------

forbid(
  files.chatLayoutTs,
  /\bRoomMessagesService\b|\bsendRoomMessage\$?\b|\bsendMessageToRoom\$?\b|\bonRoomSelected\b/,
  'o layout do chat não pode voltar ao caminho de mensagens de Sala.'
);

forbid(
  files.chatLayoutTs,
  /selectedType\s*===\s*['"]room['"]|ChatSelectionType\s*=\s*[^;]*['"]room['"]/,
  'o contrato de seleção do layout deve permanecer direct-chat only.'
);

forbid(
  files.chatLayoutHtml,
  /<app-room-interaction\b|selectedType\s*===\s*['"]room['"]|\/chat\/room-invites/,
  'o template do chat não pode renderizar conversa ou convites de Sala.'
);

forbid(
  files.chatList,
  /@Input\(\)\s*activeType\s*:\s*[^;]*['"]room['"]/,
  'a inbox ativa deve reconhecer somente chat direto.'
);

forbid(
  files.chatRooms,
  /\broomSelected\b|\bselectRoom\s*\(|CreateRoomModalComponent|RoomCreationConfirmationModalComponent/,
  '/chat/rooms deve permanecer somente leitura/encerramento, sem seleção de conversa ou criação.'
);

// -----------------------------------------------------------------------------
// Nenhum listener/badge global de convites de Sala
// -----------------------------------------------------------------------------

forbid(
  files.layoutShell,
  /\bInviteActions\b|\bselectPendingInvitesCount\b|['"]room-invites['"]/,
  'o shell global não pode reativar listener/badge de convites de Sala.'
);

forbid(
  files.storeModule,
  /import\s*\{\s*InviteEffects\s*\}|(?:^|\n)\s*InviteEffects\s*,/m,
  'InviteEffects não pode voltar aos effects globais enquanto Salas estiverem aposentadas.'
);

// -----------------------------------------------------------------------------
// Scanner de imports/símbolos estruturais aposentados
// -----------------------------------------------------------------------------

const appRoot = path.join(root, 'src/app');
const retiredSymbolPattern =
  /\b(?:RoomsModule|CreateRoomModalComponent|RoomCreationConfirmationModalComponent|RoomInteractionComponent|InviteListComponent)\b/;

for (const appFile of walkTypeScriptFiles(appRoot)) {
  const source = fs.readFileSync(appFile, 'utf8');

  if (retiredSymbolPattern.test(source)) {
    violations.push(
      `${relative(appFile)}: símbolo estrutural aposentado de Sala não pode reaparecer.`
    );
  }

  if (
    /from\s*['"][^'"]*(?:chat-module\/rooms|create-room-modal|room-create-confirm-modal|chat-module\/invite-list)[^'"]*['"]/.test(source)
  ) {
    violations.push(
      `${relative(appFile)}: import de superfície Angular aposentada de Sala não pode reaparecer.`
    );
  }
}

// -----------------------------------------------------------------------------
// Community e Room nunca compartilham autoridade/domínio
// -----------------------------------------------------------------------------

const appCommunityRoot = path.join(root, 'src/app/community');
const appRoomRoots = [
  path.join(root, 'src/app/chat-module/chat-rooms'),
  path.join(root, 'src/app/core/services/batepapo/room-services'),
];
const functionsCommunityRoot = path.join(root, 'functions/src/community');
const functionsRoomRoot = path.join(root, 'functions/src/chat/rooms');

for (const communityFile of walkTypeScriptFiles(appCommunityRoot)) {
  const source = fs.readFileSync(communityFile, 'utf8');

  if (
    /room-services|chat-module\/chat-rooms|room-compatibility\.policy/.test(source)
  ) {
    violations.push(
      `${relative(communityFile)}: Comunidades não podem depender do domínio legado de Room.`
    );
  }

  if (
    /\b(?:collection|collectionGroup|doc)\s*\([\s\S]{0,180}?(?:['"]rooms['"]|['"]rooms\/)/m.test(source)
  ) {
    violations.push(
      `${relative(communityFile)}: Comunidades não podem usar rooms como autoridade Firestore.`
    );
  }
}

for (const roomRoot of appRoomRoots) {
  for (const roomFile of walkTypeScriptFiles(roomRoot)) {
    const source = fs.readFileSync(roomFile, 'utf8');

    if (
      hasImportMatching(
        source,
        /(?:^|\/)community(?:\/|$)|(?:^|\/)community[-.]/
      )
    ) {
      violations.push(
        `${relative(roomFile)}: Room legado não pode depender do domínio Community.`
      );
    }
  }
}

for (const communityFile of walkTypeScriptFiles(functionsCommunityRoot)) {
  const source = fs.readFileSync(communityFile, 'utf8');

  if (
    hasImportMatching(
      source,
      /(?:^|\/)chat\/rooms(?:\/|$)|(?:^|\/)rooms(?:\/|$)/
    )
  ) {
    violations.push(
      `${relative(communityFile)}: Functions de Community não podem depender de Room legado.`
    );
  }
}

for (const roomFile of walkTypeScriptFiles(functionsRoomRoot)) {
  const source = fs.readFileSync(roomFile, 'utf8');

  if (
    hasImportMatching(
      source,
      /(?:^|\/)community(?:\/|$)|(?:^|\/)community[-.]/
    )
  ) {
    violations.push(
      `${relative(roomFile)}: Functions de Room não podem depender de Community.`
    );
  }
}

const sharedBridgeRoots = [
  path.join(root, 'src/app/core'),
  path.join(root, 'src/app/shared'),
  path.join(root, 'src/app/store'),
  path.join(root, 'functions/src/shared'),
  path.join(root, 'functions/src/chat/shared'),
];

for (const sharedRoot of sharedBridgeRoots) {
  for (const sharedFile of walkTypeScriptFiles(sharedRoot)) {
    const source = fs.readFileSync(sharedFile, 'utf8');
    const importsCommunity = hasImportMatching(
      source,
      /(?:^|\/)community(?:\/|$)|(?:^|\/)community[-.]/
    );
    const importsRoom = hasImportMatching(
      source,
      /room-services|chat-module\/chat-rooms|room-compatibility\.policy|(?:^|\/)chat\/rooms(?:\/|$)/
    );

    if (importsCommunity && importsRoom) {
      violations.push(
        `${relative(sharedFile)}: não criar helper/domínio compartilhado que acople Community e Room.`
      );
    }
  }
}

const uniqueViolations = [...new Set(violations)].sort();

if (uniqueViolations.length > 0) {
  console.error('[room-deprecation] Fronteira canônica de Salas violada:');

  for (const violation of uniqueViolations) {
    console.error(`  - ${violation}`);
  }

  console.error(
    '[room-deprecation] Única superfície permitida: /chat/rooms para leitura histórica e encerramento seguro.'
  );
  process.exit(1);
}

console.log(
  '[room-deprecation] OK: Rooms seguem congeladas; /chat/rooms é a única superfície legada, não há crescimento produtivo nem ponte Community/Room, e a remoção permanece guiada por evidência residual.'
);
