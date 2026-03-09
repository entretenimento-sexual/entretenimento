// C:\entretenimento\firestore-rules\tools-rules\check-braces.mjs
// Smoke test simples para balanceamento de chaves nos fragments de rules.
//
// Objetivos:
// - Verificar TODOS os fragments usados no build real.
// - Evitar falso "OK" por checar só um subconjunto.
// - Remover comentários antes de contar chaves, reduzindo ruído.
//
// Observação:
// - Isto NÃO substitui parser/compilação real das rules.
// - Serve como checagem rápida de EOF / bloco aberto / fechamento faltando.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..");
const srcDir = path.join(root, "firestore-rules");

const parts = [
  "_helpers.rules",
  "users.rules",
  "public_profiles.rules",
  "presence.rules",
  "friendRequests.rules",
  "friends_root.rules",
  "chats.rules",
  "rooms.rules",
  "rooms_participants.rules",
  "public_index.rules",
  "users_profile_socialLinks.rules",
  "public_social_links.rules",
  "preferences.rules",
  "users_friends.rules",
  "user_profile.rules",
  "users_photos.rules",
  "users_blocks.rules",
  "communities.rules",
  "invites.rules",
  "admin_logs.rules",
  "_footer.rules",
];

function stripComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function countChar(str, char) {
  return str.split(char).length - 1;
}

let total = 0;
let hasError = false;

for (const p of parts) {
  const file = path.join(srcDir, p);

  if (!fs.existsSync(file)) {
    hasError = true;
    console.error(`${p.padEnd(30)} MISSING`);
    continue;
  }

  const body = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const clean = stripComments(body);

  const opens = countChar(clean, "{");
  const closes = countChar(clean, "}");
  const delta = opens - closes;
  total += delta;

  console.log(
    `${p.padEnd(30)} opens=${String(opens).padStart(3)} closes=${String(closes).padStart(3)} delta=${String(delta).padStart(3)} total=${String(total).padStart(3)}`
  );
}

console.log(`\nFINAL total: ${total} (0 = OK)`);

if (hasError || total !== 0) {
  process.exitCode = 1;
}
