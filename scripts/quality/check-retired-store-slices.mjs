// scripts/quality/check-retired-store-slices.mjs
// -----------------------------------------------------------------------------
// RETIRED GLOBAL STORE SLICES
// -----------------------------------------------------------------------------
// O aceite jurídico pertence a TermsAcceptanceService + CurrentUserStoreService.
// Convites de Room são apenas dados legados de compatibilidade e não podem
// recuperar listener, badge ou slice NgRx global.
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

const retiredPaths = [
  'src/app/store/actions/actions.user/terms.actions.ts',
  'src/app/store/reducers/reducers.user/terms.reducer.ts',
  'src/app/store/states/states.user/terms.state.ts',
  'src/app/store/actions/actions.chat/invite.actions.ts',
  'src/app/store/reducers/reducers.chat/invite.reducer.ts',
  'src/app/store/reducers/reducers.chat/invite.reducer.spec.ts',
  'src/app/store/selectors/selectors.chat/invite.selectors.ts',
  'src/app/store/states/states.chat/invite.state.ts',
  'src/app/store/reducers/reducers.chat/index.ts',
  'src/app/header/global-invite-badge',
  'src/app/core/interfaces/interfaces-chat/invite.interface.ts',
];

const guardedFiles = [
  'src/app/store/reducers/index.ts',
  'src/app/store/states/app.state.ts',
  'src/app/store/reducers/feature-keys.ts',
  'src/app/store/store.module.ts',
  'src/app/layout/layout-shell/layout-shell.component.html',
  'src/app/header/header.module.ts',
];

const forbiddenPatterns = [
  /STORE_FEATURE\.terms\b/,
  /STORE_FEATURE\.invite\b/,
  /actions\.user\/terms\.actions/,
  /reducers\.user\/terms\.reducer/,
  /states\.user\/terms\.state/,
  /actions\.chat\/invite\.actions/,
  /reducers\.chat\/invite\.reducer/,
  /selectors\.chat\/invite\.selectors/,
  /states\.chat\/invite\.state/,
  /<app-global-invite-badge\b/,
  /\bGlobalInviteBadgeComponent\b/,
];

const violations = [];

for (const relativePath of retiredPaths) {
  if (fs.existsSync(path.join(root, relativePath))) {
    violations.push(
      `${relativePath}: artefato aposentado voltou ao repositório.`
    );
  }
}

for (const relativePath of guardedFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push(
        `${relativePath}: referência aposentada detectada (${pattern}).`
      );
    }
  }
}

if (violations.length > 0) {
  console.error('[retired-store-slices] Fronteira de aposentadoria violada:');
  for (const violation of [...new Set(violations)].sort()) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  '[retired-store-slices] OK: Terms usa owner canônico e convites de Room não mantêm slice/badge global.'
);
