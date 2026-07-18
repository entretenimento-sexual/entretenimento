// C:\entretenimento\firestore-rules\tools-rules\build-firestore-rules.mjs
// -----------------------------------------------------------------------------
// FIRESTORE RULES BUILD
// -----------------------------------------------------------------------------
//
// Constrói firestore.rules a partir de fragments modulares em ordem fixa.
//
// Decisões:
// - firestore.rules é artefato gerado; não deve ser editado manualmente;
// - fragments sensíveis ficam versionados em firestore-rules/;
// - billing.rules entra logo após users.rules por tratar dados privados e
//   financeiros internos;
// - projeções de assinantes permanecem fechadas ao cliente;
// - os marcadores por arquivo permanecem no resultado para diagnóstico.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto: tools-rules -> firestore-rules -> raiz.
const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'firestore-rules');
const outFile = path.join(root, 'firestore.rules');

const parts = [
  '_helpers.rules',

  // Documentos privados e domínios internos sensíveis.
  'users.rules',
  'billing.rules',
  'exclusive_connection_candidates.rules',

  // Discovery, presença e vitrines regionais moderadas.
  'public_profiles.rules',
  'public_profiles_photos.rules',
  'public_profiles_videos.rules',
  'presence.rules',
  'user_intent_statuses.rules',
  'venues.rules',
  'regional_hot_places.rules',

  // Relações, comunicação e notificações.
  'friendRequests.rules',
  'friends_root.rules',
  'chats.rules',
  'rooms.rules',
  'rooms_participants.rules',
  'public_index.rules',
  'notifications.rules',

  // Dados privados/públicos complementares de perfil.
  'users_profile_socialLinks.rules',
  'public_social_links.rules',
  'preferences.rules',
  'users_friends.rules',
  'user_profile.rules',
  'users_photos.rules',
  'users_videos.rules',
  'users_photo_publications.rules',
  'users_video_publications.rules',
  'users_blocks.rules',

  // Moderação e auditoria operacional.
  'moderation_reports.rules',

  // Demais módulos.
  'communities.rules',
  'invites.rules',
  'admin_logs.rules',

  '_footer.rules',
];

function build() {
  const banner =
    '// AUTO-GENERATED FILE. DO NOT EDIT.\n' +
    '// Source: firestore-rules/*\n' +
    `// Generated at: ${new Date().toISOString()}\n\n`;

  const content = parts
    .map((part) => {
      const file = path.join(srcDir, part);

      if (!fs.existsSync(file)) {
        throw new Error(`Missing rules part: ${part}`);
      }

      const body = fs
        .readFileSync(file, 'utf8')
        .replace(/\r\n/g, '\n')
        .trimEnd();

      return `// ===== ${part} =====\n${body}\n`;
    })
    .join('\n');

  const finalRules = banner + content;

  /**
   * Checagem simples de chaves.
   *
   * Não substitui a compilação do Firebase, mas detecta rapidamente fragment
   * ausente ou fechamento estrutural quebrado.
   */
  const opens = (finalRules.match(/{/g) || []).length;
  const closes = (finalRules.match(/}/g) || []).length;

  if (opens !== closes) {
    throw new Error(
      `[rules] Unbalanced braces: opens=${opens}, closes=${closes}. ` +
      'Check fragments/_footer.'
    );
  }

  fs.writeFileSync(outFile, finalRules, 'utf8');

  console.log(`[rules] built -> ${outFile}`);
}

const watch = process.argv.includes('--watch');

build();

if (watch) {
  fs.watch(srcDir, { recursive: true }, () => {
    try {
      build();
    } catch (error) {
      console.error(error);
    }
  });
}
