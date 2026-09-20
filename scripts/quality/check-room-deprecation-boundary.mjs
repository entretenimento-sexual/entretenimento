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
// - Comunidades permanecem independentes do domínio legado.
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
};

const retiredPaths = [
  'src/app/chat-module/rooms',
  'src/app/chat-module/modals/create-room-modal',
  'src/app/chat-module/modals/room-create-confirm-modal',
  'src/app/chat-module/invite-list',
];

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

function walkTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  const filesFound = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      filesFound.push(...walkTypeScriptFiles(absolutePath));
      continue;
    }

    if (
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
// Comunidades nunca dependem do legado de Salas
// -----------------------------------------------------------------------------

const communityRoot = path.join(root, 'src/app/community');

for (const communityFile of walkTypeScriptFiles(communityRoot)) {
  const source = fs.readFileSync(communityFile, 'utf8');

  if (/room-services/.test(source)) {
    violations.push(
      `${relative(communityFile)}: Comunidades não podem depender de room-services.`
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
  '[room-deprecation] OK: /chat/rooms é a única superfície legada; criação, conversa, convites e imports estruturais permanecem bloqueados.'
);
