//C:\entretenimento\firestore-rules\tools-rules\check-braces.mjs
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
  "chats.rules",
  "rooms.rules",
  "public_index.rules",
  "users_profile_socialLinks.rules",
  "public_social_links.rules",
  "preferences.rules",
  "admin_logs.rules",
  "_footer.rules",
];

let total = 0;

for (const p of parts) {
  const file = path.join(srcDir, p);
  const body = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

  const opens = (body.match(/{/g) || []).length;
  const closes = (body.match(/}/g) || []).length;
  const delta = opens - closes;
  total += delta;

  console.log(`${p.padEnd(30)} opens=${String(opens).padStart(3)} closes=${String(closes).padStart(3)} delta=${String(delta).padStart(3)} total=${String(total).padStart(3)}`);
}

console.log("\nFINAL total:", total, "(0 = OK)");
