// CANDIDATE ONLY. Never writes firestore.rules, deploys or changes active rules.
// Reuses the canonical manifest and replaces only the three registration escape hatches.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRESTORE_RULE_PARTS } from '../../firestore-rules/tools-rules/firestore-rules-parts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function replaceExactlyOnce(source, needle, replacement, fragment) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error('Candidate lockdown: expected one unique anchor in ' + fragment);
  }
  return source.replace(needle, replacement);
}

// Do not modify active Rules or private user update/read permissions.
export function buildRegistrationLockdownCandidate() {
  return FIRESTORE_RULE_PARTS.map(fragment => {
    let src = fs.readFileSync(path.join(root, 'firestore-rules', fragment), 'utf8')
      .replace(/\r\n/g, '\n').trimEnd();
    if (fragment === 'users.rules') {
      src = replaceExactlyOnce(
        src,
        'function selfCompletingRegistration(changedKeys) {\n    let data = request.resource.data;\n    let current = resource.data;\n    return isSelf(userId)',
        'function selfCompletingRegistration(changedKeys) {\n    let data = request.resource.data;\n    let current = resource.data;\n    // Only Admin SDK can complete a registration after the cutover.\n    return false && isSelf(userId)',
        fragment
      );
    }
    if (fragment === 'public_profiles_next.rules') {
      src = replaceExactlyOnce(
        src,
        'allow create: if resource == null\n    && isSelf(userId)',
        'allow create: if false && resource == null\n    && isSelf(userId)',
        fragment
      );
    }
    if (fragment === 'public_index.rules') {
      src = replaceExactlyOnce(
        src,
        'allow get: if isNicknameDoc()',
        'allow get: if false && isNicknameDoc()',
        fragment
      );
      src = replaceExactlyOnce(
        src,
        'allow create: if common()\n    && (!isNicknameDoc()',
        'allow create: if isEmailDoc() && common()\n    && (!isNicknameDoc()',
        fragment
      );
    }
    return '// ===== ' + fragment + ' =====\n' + src + '\n';
  }).join('\n');
}
