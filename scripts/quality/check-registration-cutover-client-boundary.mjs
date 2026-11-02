// Protect new Angular clients against reintroducing Firestore registration
// completion writes. Does not claim to detect already deployed legacy clients.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];
function read(relative) {
  const p = path.join(root, relative);
  if (!fs.existsSync(p)) {
    violations.push('Required source missing: ' + relative);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
}
const bootstrap = read('src/app/core/services/autentication/register/registration-bootstrap.service.ts');
const writeService = read('src/app/register-module/data-access/profile-completion-write.service.ts');
const facade = read('src/app/register-module/data-access/profile-completion.facade.ts');
const registration = read('src/app/core/services/autentication/register/register.service.ts');
const nicknameLookup = read('src/app/core/services/data-handling/firestore/validation/firestore-validation.service.ts');
// Ignore explanatory comments; only executable code can violate this boundary.
const nicknameLookupCode = nicknameLookup
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const email = bootstrap.split('  createEmailPasswordSeed$(')[1]?.split('  createSocialSeed$(')[0] ?? '';
const completion = writeService.split('  complete$(')[1]?.split('  private validateRequiredProfileFields(')[0] ?? '';
const requireToken = (text, token, scope) => {
  if (!text.includes(token)) violations.push(scope + ': missing ' + token);
};
const forbidToken = (text, token, scope) => {
  if (text.includes(token)) violations.push(scope + ': forbidden ' + token);
};
requireToken(email, "'reserveRegistrationNickname'", 'email bootstrap');
requireToken(completion, "'completeRegistrationProfile'", 'completion');
requireToken(facade, 'this.profileCompletionWrite.complete$(', 'facade');
for (const [text, scope] of [[email, 'email bootstrap'], [completion, 'completion']]) {
  for (const token of ['writeBatch(', 'runTransaction(', 'setDoc(', 'updateDoc(']) {
    forbidToken(text, token, scope);
  }
}
requireToken(registration, 'this.registrationBootstrap', 'registration');
requireToken(nicknameLookup, "'getRegistrationNicknameAvailability'", 'nickname lookup');
for (const token of ['getDoc(', 'getDocFromServer(', 'getDocFromCache(', 'public_index']) {
  forbidToken(nicknameLookupCode, token, 'nickname lookup');
}
if (violations.length) {
  console.error('[registration-cutover] boundary violations:\n' + violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('[registration-cutover] Angular registration routes via canonical callables.');
  console.log('[registration-cutover] Legacy deployed client versions require telemetry.');
}
