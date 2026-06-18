// C:\entretenimento\firestore-rules\tools-rules\check-braces.mjs
// -----------------------------------------------------------------------------
// FIRESTORE RULES BRACES CHECK
// -----------------------------------------------------------------------------
//
// Smoke test para balanceamento de chaves nos fragments utilizados pelo build.
//
// Objetivos:
// - verificar exatamente os mesmos fragments do build-firestore-rules.mjs;
// - evitar falso "OK" quando um módulo real não entra no checker;
// - detectar blocos abertos/fechamentos faltando antes da compilação Firebase.
//
// Limite:
// - esta checagem não substitui o parser/compilador oficial das rules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, '..', '..');
const srcDir = path.join(root, 'firestore-rules');

const parts = [
  '_helpers.rules',

  'users.rules',
  'billing.rules',

  'public_profiles.rules',
  'public_profiles_photos.rules',
  'presence.rules',
  'user_intent_statuses.rules',
  'venues.rules',
  'regional_hot_places.rules',

  'friendRequests.rules',
  'friends_root.rules',
  'chats.rules',
  'rooms.rules',
  'rooms_participants.rules',
  'public_index.rules',

  'users_profile_socialLinks.rules',
  'public_social_links.rules',
  'preferences.rules',
  'users_friends.rules',
  'user_profile.rules',
  'users_photos.rules',
  'users_photo_publications.rules',
  'users_blocks.rules',

  'communities.rules',
  'invites.rules',
  'admin_logs.rules',

  '_footer.rules',
];

function stripComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function countChar(text, char) {
  return text.split(char).length - 1;
}

let total = 0;
let hasError = false;

for (const part of parts) {
  const file = path.join(srcDir, part);

  if (!fs.existsSync(file)) {
    hasError = true;
    console.error(`${part.padEnd(34)} MISSING`);
    continue;
  }

  const body = fs
    .readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n');

  const clean = stripComments(body);

  const opens = countChar(clean, '{');
  const closes = countChar(clean, '}');
  const delta = opens - closes;

  total += delta;

  console.log(
    `${part.padEnd(34)} opens=${String(opens).padStart(3)} ` +
      `closes=${String(closes).padStart(3)} ` +
      `delta=${String(delta).padStart(3)} ` +
      `total=${String(total).padStart(3)}`
  );
}

console.log(`\nFINAL total: ${total} (0 = OK)`);

if (hasError || total !== 0) {
  process.exitCode = 1;
}
