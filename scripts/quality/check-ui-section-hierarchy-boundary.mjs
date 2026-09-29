// scripts/quality/check-ui-section-hierarchy-boundary.mjs
// -----------------------------------------------------------------------------
// GLOBAL SECTION HIERARCHY BOUNDARY
// -----------------------------------------------------------------------------
// Protege a regra visual transversal:
// - um título útil por bloco;
// - meta apenas quando acrescenta informação;
// - ações no mesmo cabeçalho;
// - sem kicker/eyebrow decorativo repetindo o título.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const violations = [];

const cards = read('src/styles/cards.css');
for (const required of [
  '.app-section-header',
  '.app-section-heading',
  '.app-section-title',
  '.app-section-meta',
  '.app-section-actions',
]) {
  if (!cards.includes(required)) {
    violations.push(`src/styles/cards.css missing ${required}`);
  }
}

const boundaries = [
  {
    path: 'src/app/user-profile/user-profile-view/user-profile-view.component.html',
    required: [
      'class="profile-card profile-media-entry"',
      'class="app-section-header"',
      'class="app-section-title"',
      'Meus vídeos',
    ],
    forbidden: [
      'Minha presença',
      'Biblioteca privada',
      'Privados por padrão',
      'Processamento seguro',
      'Publicação controlada',
      'profile-kicker',
      'btn btn-secondary',
    ],
  },
  {
    path: 'src/app/user-profile/user-photo-manager/user-photo-manager.component.html',
    required: [
      'app-section-header',
      'app-section-title',
      'app-section-meta',
      'app-section-actions',
    ],
    forbidden: [
      'Vitrine do perfil',
      'fotos publicadas no perfil',
      'Expanda para ver uma prévia',
      'photo-manager__eyebrow',
    ],
  },
  {
    path: 'src/app/community/profile-my-communities/profile-my-communities.component.html',
    required: [
      'app-section-header',
      'app-section-title',
      'Minhas comunidades',
    ],
    forbidden: [
      'Sua participação',
      'profile-my-communities__eyebrow',
    ],
  },
  {
    path: 'src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component.html',
    required: [
      'app-section-header',
      'app-section-title',
      'app-section-actions',
    ],
    forbidden: [],
  },
];

for (const boundary of boundaries) {
  const source = read(boundary.path);

  for (const required of boundary.required) {
    if (!source.includes(required)) {
      violations.push(`${boundary.path} missing ${required}`);
    }
  }

  for (const forbidden of boundary.forbidden) {
    if (source.includes(forbidden)) {
      violations.push(`${boundary.path} reintroduced redundant copy: ${forbidden}`);
    }
  }
}

const profileCss = read(
  'src/app/user-profile/user-profile-view/user-profile-view.component.css'
);
for (const forbidden of [
  '.profile-kicker',
  '.profile-video-entry',
  '.profile-video-entry__features',
]) {
  if (profileCss.includes(forbidden)) {
    violations.push(
      'user-profile-view.component.css contains obsolete selector ' + forbidden
    );
  }
}

if (violations.length > 0) {
  console.error('[ui-section-hierarchy] Boundary violations:');
  for (const violation of violations) {
    console.error('  - ' + violation);
  }
  process.exit(1);
}

console.log(
  '[ui-section-hierarchy] OK: canonical title/meta/action hierarchy is preserved without redundant profile/media/community kickers.'
);
