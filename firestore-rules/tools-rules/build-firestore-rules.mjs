// C:\entretenimento\firestore-rules\tools-rules\build-firestore-rules.mjs
// Script para construir o arquivo firestore.rules a partir de partes modulares.
// Não esquecer commentários explicativos, especialmente sobre a estrutura de pastas e a ordem de concatenação.'
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build previsível:
 * - Concatena partes em ordem fixa
 * - Gera C:\entretenimento\firestore.rules
 * - Insere marcadores por arquivo para debug
 * - Verifica balanceamento simples de chaves no final
 */

// raiz do projeto (tools-rules -> firestore-rules -> raiz)
const root = path.resolve(__dirname, "..", "..");
const srcDir = path.join(root, "firestore-rules");
const outFile = path.join(root, "firestore.rules");

const parts = [
  "_helpers.rules",
  "users.rules",
  "public_profiles.rules",
  "presence.rules",
  "friendRequests.rules",
  "chats.rules",
  "rooms.rules",
  "public_index.rules",
  "users_profile_socialLinks.rules",
  "public_social_links.rules",
  "preferences.rules",
  "users_friends.rules",
  "admin_logs.rules",
  "_footer.rules",
];

function build() {
  const banner =
    `// AUTO-GENERATED FILE. DO NOT EDIT.\n` +
    `// Source: firestore-rules/*\n` +
    `// Generated at: ${new Date().toISOString()}\n\n`;

  const content = parts
    .map((p) => {
      const file = path.join(srcDir, p);
      if (!fs.existsSync(file)) throw new Error(`Missing rules part: ${p}`);
      const body = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trimEnd();
      return `// ===== ${p} =====\n${body}\n`;
    })
    .join("\n");

  const finalRules = banner + content;

  // check simples de chaves (não é parser, mas pega 99% dos erros de EOF)
  const opens = (finalRules.match(/{/g) || []).length;
  const closes = (finalRules.match(/}/g) || []).length;
  if (opens !== closes) {
    throw new Error(`[rules] Unbalanced braces: opens=${opens}, closes=${closes}. Check fragments/_footer.`);
  }

  fs.writeFileSync(outFile, finalRules, "utf8");
  console.log(`[rules] built -> ${outFile}`);
}

const watch = process.argv.includes("--watch");
build();

if (watch) {
  fs.watch(srcDir, { recursive: true }, () => {
    try { build(); } catch (e) { console.error(e); }
  });
}
