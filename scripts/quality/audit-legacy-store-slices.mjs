import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const appRoot = path.join(root, 'src', 'app');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

const productionTs = walk(appRoot)
  .filter((filePath) =>
    filePath.endsWith('.ts')
    && !/\.(?:spec|test)\.ts$/i.test(filePath)
    && !filePath.includes(`${path.sep}test${path.sep}`)
    && !filePath.includes(`${path.sep}visual-validation${path.sep}`)
  )
  .map((filePath) => ({
    filePath,
    relative: relative(filePath),
    source: fs.readFileSync(filePath, 'utf8'),
  }));

const slices = {
  terms: {
    moduleFragments: [
      'actions.user/terms.actions',
      'reducers.user/terms.reducer',
      'states.user/terms.state',
    ],
    symbols: [
      'acceptTerms',
      'loadTerms',
      'loadTermsSuccess',
      'loadTermsFailure',
      'acceptTermsSuccess',
      'acceptTermsFailure',
      'TERMS_ACTION_TYPES',
      'termsReducer',
      'ITermsState',
      'initialTermsState',
      'STORE_FEATURE.terms',
    ],
  },
  invite: {
    moduleFragments: [
      'actions.chat/invite.actions',
      'reducers.chat/invite.reducer',
      'selectors.chat/invite.selectors',
      'states.chat/invite.state',
    ],
    symbols: [
      'LoadInvites',
      'LoadInvitesSuccess',
      'LoadInvitesFailure',
      'AcceptInvite',
      'AcceptInviteSuccess',
      'AcceptInviteFailure',
      'DeclineInvite',
      'DeclineInviteSuccess',
      'DeclineInviteFailure',
      'StopInvites',
      'ClearInvitesState',
      'selectInviteState',
      'selectInviteOwnerUid',
      'selectInvites',
      'selectInvitesLoading',
      'selectInvitesLoaded',
      'selectInvitesError',
      'selectPendingInvites',
      'selectPendingInvitesCount',
      'inviteReducer',
      'InviteState',
      'initialInviteState',
      'STORE_FEATURE.invite',
    ],
  },
};

for (const [sliceName, slice] of Object.entries(slices)) {
  const matches = [];

  for (const item of productionTs) {
    const moduleHits = slice.moduleFragments.filter((fragment) =>
      item.source.includes(fragment)
    );
    const symbolHits = slice.symbols.filter((symbol) =>
      item.source.includes(symbol)
    );

    if (moduleHits.length === 0 && symbolHits.length === 0) continue;

    matches.push({
      file: item.relative,
      moduleHits,
      symbolHits,
    });
  }

  console.log(
    `[legacy-store-slices] ${sliceName}: ${matches.length} arquivo(s) com referência.`
  );
  for (const match of matches) {
    console.log(
      `  - ${match.file} :: modules=[${match.moduleHits.join(', ')}] symbols=[${match.symbolHits.join(', ')}]`
    );
  }
}
