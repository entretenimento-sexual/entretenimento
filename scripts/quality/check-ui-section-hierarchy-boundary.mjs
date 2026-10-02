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
  '.app-page-header',
  '.app-page-heading',
  '.app-page-title',
  '.app-page-lead',
  '.app-page-actions',
  '.app-section-header',
  '.app-section-heading',
  '.app-section-title',
  '.app-section-meta',
  '.app-section-actions',
  '.app-disclosure',
  '.app-disclosure__summary',
  '.app-disclosure__title',
  '.app-disclosure__state',
  '.app-disclosure__content',
]) {
  if (!cards.includes(required)) {
    violations.push(`src/styles/cards.css missing ${required}`);
  }
}

const boundaries = [
  {
    path: 'src/app/preferences/pages/preferences-editor/preferences-editor.component.html',
    required: [
      '<app-page-header title="Preferências">',
      'app-disclosure',
      'app-disclosure__state',
      'app-action app-action--ghost',
    ],
    forbidden: [
      'Defina quem você quer encontrar e como deseja aparecer.',
      'Preferências essenciais disponíveis sem assinatura.',
      'Abra apenas a categoria que deseja alterar.',
      'availability-section__action',
      'btn btn-secondary',
    ],
  },
  {
    path: 'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    required: [
      'app-disclosure',
      'app-disclosure__summary',
      'app-disclosure__title',
      'app-disclosure__content',
      'Como considerar',
      'app-action app-action--primary',
    ],
    forbidden: [
      'O tipo de conexão que você procura.',
      'Quem pode aparecer nas suas combinações.',
      'Características que você escolhe declarar sobre si.',
      'Práticas desejadas e características físicas procuradas.',
      'Idade, distância e tipos de perfil aceitos.',
      'Privacidade e visibilidade do seu perfil.',
      '>Configurar<',
      'Como usar estas escolhas',
      'Preferências salvas.',
      'btn btn-primary',
    ],
  },
  {
    path: 'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
    required: [
      '<app-page-header title="Preferências">',
      'app-action app-action--ghost',
    ],
    forbidden: [
      'Ajuste como seu perfil aparece, como você recebe notificações',
      'btn btn-secondary',
    ],
  },
  {
    path: 'src/app/preferences/pages/discovery-settings/discovery-settings.component.html',
    required: [
      'title="Descoberta e privacidade"',
      'app-action app-action--ghost',
    ],
    forbidden: [
      'Discovery settings',
      'Controle do modo de descoberta, privacidade',
      'Editar descoberta e visibilidade',
      'btn btn-secondary',
    ],
  },
  {
    path: 'src/app/preferences/pages/notification-settings/notification-settings.component.html',
    required: [
      '<app-page-header title="Notificações">',
      'Notificações neste navegador',
      'app-action app-action--ghost',
      'app-action app-action--primary',
    ],
    forbidden: [
      'subtitle="Escolha quais alertas',
      'push-device-card__eyebrow',
      'Notificações no navegador',
      'btn btn-secondary',
    ],
  },
  {
    path: 'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
    required: [
      'intent-context app-disclosure',
      'app-disclosure__summary',
      'app-disclosure__title',
      'app-disclosure__content',
      'app-action app-action--primary',
    ],
    forbidden: [
      'Mostra atividade imediata.',
      'Mantém o sinal durante o dia.',
      'Cidade, expiração e tags temporárias.',
      '>Disponível<',
      'Disponibilidade salva.',
      'btn btn-primary',
    ],
  },
  {
    path: 'src/app/community/community-settings/community-settings.component.html',
    required: [
      'app-section-header',
      'app-section-title',
      'app-action app-action--primary',
    ],
    forbidden: [
      'Configuração editorial',
      'fa-sliders',
    ],
  },
  {
    path: 'src/app/layout/friend-management/friend-settings/friend-settings.component.html',
    required: [
      'app-section-header',
      'app-section-title',
      'app-action app-action--primary',
    ],
    forbidden: [
      'Configurações de Amizade',
      'Salvar Configurações',
      'mat-button',
    ],
  },
  {
    path: 'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
    required: [
      'app-action app-action--primary',
    ],
    forbidden: [
      '<h2 id="visibility-settings-title"',
      'btn btn-primary',
    ],
  },
  {
    path: 'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    required: [
      'aria-label="Estado atual da descoberta e privacidade"',
    ],
    forbidden: [
      'panel-title',
      'panel-subtitle',
      'Descoberta e visibilidade</h2>',
    ],
  },
  {
    path: 'src/app/user-profile/user-profile-view/user-profile-view.component.html',
    required: [
      'class="profile-card app-card profile-media-entry"',
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


const sendRequestDialogHtml = read(
  'src/app/shared/components-globais/user-card/send-request-dialog/send-request-dialog.component.html'
);
for (const required of [
  'policy app-card app-card--flat app-card--compact',
  'cancel-action app-action app-action--ghost',
  'send-action app-action app-action--primary',
]) {
  if (!sendRequestDialogHtml.includes(required)) {
    violations.push(
      'send-request-dialog.component.html missing canonical UI contract ' + required
    );
  }
}

const sendRequestDialogCss = read(
  'src/app/shared/components-globais/user-card/send-request-dialog/send-request-dialog.component.css'
);
for (const forbidden of [
  'box-shadow:',
  'linear-gradient(',
  'radial-gradient(',
  'border-radius: 999px',
  '!important',
  '.mat-mdc-form-field.mat-mdc-form-field-appearance-fill',
  ':host-context(html.dark-mode)',
]) {
  if (sendRequestDialogCss.includes(forbidden)) {
    violations.push(
      'send-request-dialog.component.css contains duplicate dialog/material chrome ' + forbidden
    );
  }
}

const exploreCommunityContentCardHtml = read(
  'src/app/explore/components/explore-community-content-card/explore-community-content-card.component.html'
);
for (const required of [
  'community-content-card app-card app-card--flat app-card--compact',
  'community-content-card__media app-media-frame',
  'community-content-card__action app-action app-action--ghost',
]) {
  if (!exploreCommunityContentCardHtml.includes(required)) {
    violations.push(
      'explore-community-content-card.component.html missing canonical UI contract ' + required
    );
  }
}

const exploreCommunityContentCardCss = read(
  'src/app/explore/components/explore-community-content-card/explore-community-content-card.component.css'
);
for (const forbidden of [
  'border-radius: 0.95rem',
  'background: color-mix(',
  '.community-content-card a:focus-visible',
  ':host-context(html.high-contrast) .community-content-card',
  '!important',
]) {
  if (exploreCommunityContentCardCss.includes(forbidden)) {
    violations.push(
      'explore-community-content-card.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const suggestedProfilesHtml = read(
  'src/app/dashboard/suggested-profiles/suggested-profiles.component.html'
);
for (const required of [
  'suggested-profiles-hero app-card app-card--flat app-card--media',
  'profile-card app-card app-card--flat app-card--interactive',
  'profile-card__status app-chip app-chip--overlay',
  'profile-card__age app-chip app-chip--muted',
  'profile-card__action app-action app-action--primary',
]) {
  if (!suggestedProfilesHtml.includes(required)) {
    violations.push(
      'suggested-profiles.component.html missing canonical UI contract ' + required
    );
  }
}

const suggestedProfilesCss = read(
  'src/app/dashboard/suggested-profiles/suggested-profiles.component.css'
);
for (const forbidden of [
  '.suggested-profiles-hero.app-card',
  '.profile-card.app-card',
  '.profiles-grid.app-card-grid',
  '.profile-card__action.app-action',
  'box-shadow:',
  '@media (prefers-reduced-motion: reduce)',
  'html.high-contrast .profile-card',
  '!important',
]) {
  if (suggestedProfilesCss.includes(forbidden)) {
    violations.push(
      'suggested-profiles.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const profileListHtml = read(
  'src/app/layout/profile-list/profile-list.component.html'
);
for (const required of [
  '<app-content-state',
  'state="loading"',
  'state="error"',
  'state="empty"',
  'profile-card app-card app-card--flat app-card--interactive',
  'profile-card__status app-chip',
]) {
  if (!profileListHtml.includes(required)) {
    violations.push(
      'profile-list.component.html missing canonical UI contract ' + required
    );
  }
}
for (const forbidden of [
  'profile-list-state',
]) {
  if (profileListHtml.includes(forbidden)) {
    violations.push(
      'profile-list.component.html contains legacy local state UI ' + forbidden
    );
  }
}

const profileListCss = read(
  'src/app/layout/profile-list/profile-list.component.css'
);
for (const forbidden of [
  '.profile-list-state',
  '@keyframes profile-list-spin',
  'box-shadow:',
  '@media (prefers-reduced-motion: reduce)',
  'html.high-contrast .profile-card',
  '!important',
]) {
  if (profileListCss.includes(forbidden)) {
    violations.push(
      'profile-list.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const userIntentStatusRadarHtml = read(
  'src/app/dashboard/user-intent-status/user-intent-status-radar/user-intent-status-radar.component.html'
);
for (const required of [
  'class="visually-hidden"',
  'intent-radar__summary app-chip app-chip--muted',
  'intent-radar__state app-card app-card--flat app-card--compact',
  'intent-status-card app-card app-card--flat',
  'intent-status-card__action intent-status-card__action--secondary app-action app-action--ghost',
  'intent-status-card__action intent-status-card__action--primary app-action app-action--primary',
]) {
  if (!userIntentStatusRadarHtml.includes(required)) {
    violations.push(
      'user-intent-status-radar.component.html missing canonical UI contract ' + required
    );
  }
}

const userIntentStatusRadarCss = read(
  'src/app/dashboard/user-intent-status/user-intent-status-radar/user-intent-status-radar.component.css'
);
for (const forbidden of [
  'box-shadow: 0 6px 18px',
  '.intent-status-card__action:hover,',
  '.intent-status-card__action:focus-visible {',
  '.intent-status-card__action:active {',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (userIntentStatusRadarCss.includes(forbidden)) {
    violations.push(
      'user-intent-status-radar.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const friendCardsHtml = read(
  'src/app/layout/friend-management/friend-cards/friend-cards.component.html'
);
for (const required of [
  'class="visually-hidden"',
  '<app-content-state',
  'state="loading"',
  'state="empty"',
  'friend-cards__end app-section-meta',
]) {
  if (!friendCardsHtml.includes(required)) {
    violations.push(
      'friend-cards.component.html missing canonical UI contract ' + required
    );
  }
}
for (const forbidden of [
  '<mat-spinner',
  'class="state ',
  'class="sr-only"',
]) {
  if (friendCardsHtml.includes(forbidden)) {
    violations.push(
      'friend-cards.component.html contains legacy local state UI ' + forbidden
    );
  }
}

const friendCardsCss = read(
  'src/app/layout/friend-management/friend-cards/friend-cards.component.css'
);
for (const forbidden of [
  '.state {',
  '.state--loading',
  '.state--empty',
  '.state--end',
  'box-shadow:',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (friendCardsCss.includes(forbidden)) {
    violations.push(
      'friend-cards.component.css contains duplicate shared state chrome ' + forbidden
    );
  }
}

const friendListPageHtml = read(
  'src/app/layout/friend-management/friend-list-page/friend-list-page.component.html'
);
for (const required of [
  'friends-page app-page',
  'friends-page__metric app-card app-card--flat app-card--compact',
  'friends-page__metric friends-page__metric--online app-card app-card--flat app-card--compact',
  'friends-controls app-card app-card--flat app-card--compact',
]) {
  if (!friendListPageHtml.includes(required)) {
    violations.push(
      'friend-list-page.component.html missing canonical UI contract ' + required
    );
  }
}

const friendListPageCss = read(
  'src/app/layout/friend-management/friend-list-page/friend-list-page.component.css'
);
for (const forbidden of [
  '.friends-controls.app-card',
  'box-shadow: none',
  '@media (prefers-reduced-motion: reduce)',
  'html.high-contrast .friends-controls',
  '!important',
]) {
  if (friendListPageCss.includes(forbidden)) {
    violations.push(
      'friend-list-page.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const userIntentStatusComposerHtml = read(
  'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component.html'
);
for (const required of [
  'intent-composer app-card app-card--flat',
  'class="app-control"',
  'intent-composer__venues app-card app-card--flat app-card--compact',
  'intent-composer__venue-option app-card app-card--flat app-card--compact app-card--interactive',
  'intent-composer__footer app-form-actions',
]) {
  if (!userIntentStatusComposerHtml.includes(required)) {
    violations.push(
      'user-intent-status-composer.component.html missing canonical UI contract ' + required
    );
  }
}

const userIntentStatusComposerCss = read(
  'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component.css'
);
for (const forbidden of [
  '.intent-composer__field input,',
  '.intent-composer__venue-option:hover,',
  '@media (prefers-reduced-motion: reduce)',
  ':host-context(html.high-contrast) .intent-composer',
  '!important',
  'box-shadow: none',
]) {
  if (userIntentStatusComposerCss.includes(forbidden)) {
    violations.push(
      'user-intent-status-composer.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const friendRequestsHtml = read(
  'src/app/layout/friend-management/friend-requests/friend-requests.component.html'
);
for (const required of [
  'friend-requests__tab-count app-chip app-chip--muted',
  'class="visually-hidden"',
  'request-card request-card--inbound app-card app-card--flat',
  'request-card request-card--outbound app-card app-card--flat',
  'request-card__role app-chip app-chip--muted',
  'request-action request-action--accept app-action',
  'request-action request-action--decline app-action app-action--ghost',
  'request-action request-action--block app-action app-action--ghost app-action--danger',
]) {
  if (!friendRequestsHtml.includes(required)) {
    violations.push(
      'friend-requests.component.html missing canonical UI contract ' + required
    );
  }
}

const friendRequestsCss = read(
  'src/app/layout/friend-management/friend-requests/friend-requests.component.css'
);
for (const forbidden of [
  ':host ::ng-deep .mat-mdc-tab .mdc-tab__text-label',
  ':host ::ng-deep .mat-mdc-tab.mdc-tab--active .mdc-tab__text-label',
  '.request-action[disabled] {',
  'box-shadow: 0 5px 16px',
  'box-shadow: 0 8px 20px',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (friendRequestsCss.includes(forbidden)) {
    violations.push(
      'friend-requests.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityAdminTimelineHtml = read(
  'src/app/community/admin-timeline/community-admin-timeline.component.html'
);
for (const required of [
  'community-admin-timeline app-card app-card--flat',
  'community-admin-timeline__header app-section-header',
  'class="app-section-heading"',
  'class="app-section-title"',
  'class="app-section-meta"',
  'class="app-action app-action--ghost"',
  'community-admin-timeline__state app-card app-card--flat app-card--compact',
]) {
  if (!communityAdminTimelineHtml.includes(required)) {
    violations.push(
      'community-admin-timeline.component.html missing canonical UI contract ' + required
    );
  }
}
if (communityAdminTimelineHtml.includes('Auditoria consumível')) {
  violations.push(
    'community-admin-timeline.component.html reintroduced redundant eyebrow Auditoria consumível'
  );
}

const communityAdminTimelineCss = read(
  'src/app/community/admin-timeline/community-admin-timeline.component.css'
);
for (const forbidden of [
  '.community-admin-timeline button {',
  '.community-admin-timeline button:disabled {',
  '.community-admin-timeline__state button {',
  '.community-admin-timeline__footer button {',
]) {
  if (communityAdminTimelineCss.includes(forbidden)) {
    violations.push(
      'community-admin-timeline.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityInvitesPageHtml = read(
  'src/app/community/invites/community-invites-page.component.html'
);
for (const required of [
  'community-invites app-page',
  'community-invites__hub-header app-page-header',
  'class="app-page-title"',
  'community-invites__section-header app-section-heading',
  'class="app-section-title"',
  'class="app-section-meta"',
  'community-invites__state app-card app-card--flat app-card--compact',
  'community-invites__empty app-card app-card--flat app-card--compact',
  'community-invite-card app-card app-card--flat',
  'community-invite-card__decline app-action app-action--ghost',
  'community-invite-card__accept app-action app-action--primary',
]) {
  if (!communityInvitesPageHtml.includes(required)) {
    violations.push(
      'community-invites-page.component.html missing canonical UI contract ' + required
    );
  }
}

const communityInvitesPageCss = read(
  'src/app/community/invites/community-invites-page.component.css'
);
for (const forbidden of [
  '.community-invites__state button,',
  '.community-invite-card__actions button {',
  '.community-invite-card__decline {',
  '.community-invite-card__accept {',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (communityInvitesPageCss.includes(forbidden)) {
    violations.push(
      'community-invites-page.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const venueCreateHtml = read(
  'src/app/community/venue-create/venue-community-create-page.component.html'
);
for (const required of [
  'venue-create app-page',
  'venue-create__header app-page-header',
  'venue-create__back app-action app-action--ghost',
  'class="app-page-heading"',
  'class="app-page-title"',
  'class="app-page-lead"',
  'class="app-card app-card--flat"',
  'class="app-section-title"',
  'class="app-control"',
  'venue-create__actions app-card app-card--flat app-card--compact',
  'class="app-action app-action--primary" [disabled]="submitting()"',
]) {
  if (!venueCreateHtml.includes(required)) {
    violations.push(
      'venue-community-create-page.component.html missing canonical UI contract ' + required
    );
  }
}

const venueCreateCss = read(
  'src/app/community/venue-create/venue-community-create-page.component.css'
);
for (const forbidden of [
  '.venue-create__form input,',
  '.venue-create__actions a,',
  '.venue-create__actions button {',
  ':host-context(.high-contrast)',
  'border-radius: 999px',
]) {
  if (venueCreateCss.includes(forbidden)) {
    violations.push(
      'venue-community-create-page.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityInviteManagementHtml = read(
  'src/app/community/invite-management/community-invite-management.component.html'
);
for (const required of [
  'community-invite-management app-card app-card--flat',
  'community-invite-management__header app-section-header',
  'class="app-section-title"',
  'class="app-control"',
  'class="app-action app-action--primary"',
  'community-invite-candidate app-card app-card--flat app-card--compact',
  'class="app-chip app-chip--muted"',
  'class="app-action app-action--ghost app-action--danger"',
]) {
  if (!communityInviteManagementHtml.includes(required)) {
    violations.push(
      'community-invite-management.component.html missing canonical UI contract ' + required
    );
  }
}
if (communityInviteManagementHtml.includes('<span>Participação</span>')) {
  violations.push(
    'community-invite-management.component.html reintroduced redundant eyebrow Participação'
  );
}

const communityInviteManagementCss = read(
  'src/app/community/invite-management/community-invite-management.component.css'
);
for (const forbidden of [
  '.community-invite-management button {',
  '.community-invite-management button:disabled',
  '.community-invite-management input:focus-visible,',
  ':host-context(.high-contrast) .community-invite-candidate,',
]) {
  if (communityInviteManagementCss.includes(forbidden)) {
    violations.push(
      'community-invite-management.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityMembersPageHtml = read(
  'src/app/community/members/community-members-page.component.html'
);
for (const required of [
  'community-members app-page',
  'class="app-action app-action--ghost"',
  'community-members__header app-section-heading',
  'class="app-section-title"',
  'class="app-page-title"',
  'class="app-control"',
  'community-members__search-clear app-action app-action--ghost',
  'community-members__state app-card app-card--flat app-card--compact',
  'community-members__item app-card app-card--flat app-card--compact',
]) {
  if (!communityMembersPageHtml.includes(required)) {
    violations.push(
      'community-members-page.component.html missing canonical UI contract ' + required
    );
  }
}
for (const forbidden of [
  '<span>Comunidade</span>',
]) {
  if (communityMembersPageHtml.includes(forbidden)) {
    violations.push(
      'community-members-page.component.html reintroduced redundant copy ' + forbidden
    );
  }
}

const communityMembersPageCss = read(
  'src/app/community/members/community-members-page.component.css'
);
for (const forbidden of [
  '.community-members__state button,',
  '.community-members__more button {',
  '.community-members__search-clear:focus-visible',
  ':host-context(.high-contrast) .community-members__item,',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (communityMembersPageCss.includes(forbidden)) {
    violations.push(
      'community-members-page.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityFeedCommentsHtml = read(
  'src/app/community/feed-comments/community-feed-comments.component.html'
);
for (const required of [
  'feed-comments__close app-action app-action--ghost',
  'feed-comments__more app-action app-action--ghost',
  'feed-comment__menu-panel app-card app-card--flat app-card--media',
  'feed-comment__menu-action app-action app-action--ghost',
  'feed-comment__confirmation app-card app-card--flat app-card--compact',
  'class="app-control"',
  'feed-comments__reply-target app-card app-card--flat app-card--compact',
  'class="app-action app-action--primary"',
  'feed-comments__send-label visually-hidden',
]) {
  if (!communityFeedCommentsHtml.includes(required)) {
    violations.push(
      'community-feed-comments.component.html missing canonical UI contract ' + required
    );
  }
}

const communityFeedCommentsCss = read(
  'src/app/community/feed-comments/community-feed-comments.component.css'
);
for (const forbidden of [
  '.feed-comments__state button,',
  'box-shadow: 0 0.7rem 1.8rem',
  '.feed-comment__menu-action:hover {',
  '.feed-comment__confirmation button {',
  'button:disabled {',
  'textarea:focus-visible,',
  '.feed-comments__send-label {',
]) {
  if (communityFeedCommentsCss.includes(forbidden)) {
    violations.push(
      'community-feed-comments.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityOwnershipManagementHtml = read(
  'src/app/community/ownership-management/community-ownership-management.component.html'
);
for (const required of [
  'community-ownership-management app-card app-card--flat',
  'community-ownership-management__header app-section-header',
  'class="app-section-heading"',
  'class="app-section-title"',
  'community-ownership-management__refresh app-action app-action--ghost',
  'community-ownership-management__intro app-section-meta',
  'community-ownership-management__transfer app-card app-card--flat app-card--compact',
  'class="app-control"',
  'community-ownership-management__transfer-action app-action app-action--primary',
  'community-ownership-management__danger-zone app-card app-card--flat app-card--compact',
  'class="app-action app-action--danger"',
]) {
  if (!communityOwnershipManagementHtml.includes(required)) {
    violations.push(
      'community-ownership-management.component.html missing canonical UI contract ' + required
    );
  }
}

const communityOwnershipManagementCss = read(
  'src/app/community/ownership-management/community-ownership-management.component.css'
);
for (const forbidden of [
  '.community-ownership-management__transfer-action,',
  '.community-ownership-management button:disabled',
  '.community-ownership-management button:focus-visible',
  ':host-context(.high-contrast) .community-ownership-management__refresh,',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (communityOwnershipManagementCss.includes(forbidden)) {
    violations.push(
      'community-ownership-management.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityMembershipManagementHtml = read(
  'src/app/community/membership-management/community-membership-management.component.html'
);
for (const required of [
  'community-management-hub app-card app-card--flat',
  'community-management-hub__header app-section-header',
  'community-management-hub__heading app-section-heading',
  'class="app-section-title"',
  'class="app-section-meta"',
  'community-management-hub__nav app-segmented',
  'class="app-segmented__button"',
  'community-management-hub__badge app-chip app-chip--primary',
  'community-management-hub__regularization app-card app-card--flat app-card--compact',
  'community-management-hub__capacity-alert app-card app-card--flat app-card--compact',
  'community-management-hub__card app-card app-card--flat app-card--compact app-card--interactive',
  'community-membership-management__header app-section-header',
  'community-membership-management__refresh app-action app-action--ghost',
  'community-membership-management__count app-chip app-chip--muted',
  'class="is-approve app-action app-action--primary"',
  'class="is-reject app-action app-action--ghost"',
]) {
  if (!communityMembershipManagementHtml.includes(required)) {
    violations.push(
      'community-membership-management.component.html missing canonical UI contract ' + required
    );
  }
}

const communityMembershipManagementCss = read(
  'src/app/community/membership-management/community-membership-management.component.css'
);
for (const forbidden of [
  '.community-management-hub__nav button {',
  '.community-management-hub__nav button.is-active {',
  '.community-management-hub__regularization-actions a,',
  'button.community-management-hub__card:hover {',
  '.community-membership-management__actions button {',
  ':host-context(.high-contrast) .community-management-hub__nav button,',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (communityMembershipManagementCss.includes(forbidden)) {
    violations.push(
      'community-membership-management.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityMemberRosterHtml = read(
  'src/app/community/member-roster-management/community-member-roster-management.component.html'
);
for (const required of [
  'community-member-roster app-card app-card--flat',
  'community-member-roster__header app-section-header',
  'class="app-section-heading"',
  'class="app-section-title"',
  'class="app-section-meta"',
  'community-member-roster__refresh app-action app-action--ghost',
  'community-member-roster__status-tabs app-segmented',
  'class="app-segmented__button"',
  'class="app-control"',
  'community-member-roster__confirmation app-card app-card--flat app-card--compact',
  'community-member-roster__item app-card app-card--flat app-card--compact',
]) {
  if (!communityMemberRosterHtml.includes(required)) {
    violations.push(
      'community-member-roster-management.component.html missing canonical UI contract ' + required
    );
  }
}

const communityMemberRosterCss = read(
  'src/app/community/member-roster-management/community-member-roster-management.component.css'
);
for (const forbidden of [
  '.community-member-roster__status-tabs button {',
  '.community-member-roster__state button,',
  '.community-member-roster__actions button,',
  '.community-member-roster__confirmation button {',
  ':host-context(.high-contrast) .community-member-roster,',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (communityMemberRosterCss.includes(forbidden)) {
    violations.push(
      'community-member-roster-management.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const communityFeedMainCss = read(
  'src/app/community/feed/community-feed.component.css'
);
for (const forbidden of [
  '.community-feed__sr-only {',
  '.community-feed__state button,',
  '.community-feed__more button {',
  '.community-post__menu-action:hover:not(:disabled)',
  '.community-post__confirmation-actions button {',
  'box-shadow: 0 0.75rem 2rem',
  ':host-context(.high-contrast) .community-post__menu-panel,',
  ':host-context(.high-contrast) .community-post__confirmation,',
]) {
  if (communityFeedMainCss.includes(forbidden)) {
    violations.push(
      'community-feed.component.css contains duplicate shared interaction chrome ' + forbidden
    );
  }
}

const communityFeedHtml = read(
  'src/app/community/feed/community-feed.component.html'
);
for (const required of [
  'community-feed__composer app-card app-card--flat app-card--compact',
  'class="visually-hidden"',
  'community-feed__composer-tool app-action app-action--ghost',
  'community-feed__send app-action app-action--primary',
  'community-post__menu-panel app-card app-card--flat app-card--media',
  'community-post__menu-action app-action app-action--ghost',
  'community-post__confirmation app-card app-card--flat app-card--compact',
  'class="app-control"',
  'community-post__confirmation-actions app-form-actions',
  'community-feed__location-preview app-card app-card--flat app-card--compact',
  'class="app-action app-action--ghost"',
]) {
  if (!communityFeedHtml.includes(required)) {
    violations.push(
      'community-feed.component.html missing canonical interaction contract ' + required
    );
  }
}

const communityFeedInteractionsCss = read(
  'src/app/community/feed/community-feed.interactions.css'
);
for (const forbidden of [
  'box-shadow: 0 0.45rem 1.25rem',
  'box-shadow: 0 0.25rem 0.8rem',
  'box-shadow: 0 0 0 3px',
  'box-shadow: 0 0.24rem 0.65rem',
  'box-shadow: 0 0.38rem 0.8rem',
  ':host-context(.high-contrast) .community-feed__new-items button',
  ':host-context(.high-contrast) .community-feed__composer',
  '.community-feed__new-items button:hover',
]) {
  if (communityFeedInteractionsCss.includes(forbidden)) {
    violations.push(
      'community-feed.interactions.css contains duplicate shared interaction chrome ' + forbidden
    );
  }
}

const communityCreateHtml = read(
  'src/app/community/community-create/community-create-page.component.html'
);
for (const required of [
  'community-create app-page',
  'community-create__header app-page-header',
  'community-create__back app-action app-action--ghost',
  'class="app-page-heading"',
  'class="app-page-title"',
  'class="app-page-lead"',
  'community-create__preview app-card app-card--flat app-card--compact',
  'community-create__gate app-card app-card--flat',
  'community-create__section app-card app-card--flat',
  'community-create__tag-count app-chip app-chip--muted',
  'community-create__choice app-choice app-choice--roomy',
  'class="app-control"',
  'community-create__capacity-option app-card app-card--flat app-card--compact app-card--media',
  'community-create__tag app-chip app-chip--muted',
  '[class.app-chip--primary]="isTagSelected(tag.id)"',
  'community-create__actions app-card app-card--flat app-card--compact',
  'class="app-action app-action--primary" [disabled]="submitting()"',
]) {
  if (!communityCreateHtml.includes(required)) {
    violations.push(
      'community-create-page.component.html missing canonical UI contract ' + required
    );
  }
}

const communityCreateCss = read(
  'src/app/community/community-create/community-create-page.component.css'
);
for (const forbidden of [
  '.community-create__gate button,',
  '.community-create__tag-state button {',
  '.community-create__actions a,',
  '.community-create__actions button {',
  ':host-context(.high-contrast) .community-create__section,',
  ':host-context(.high-contrast) .community-create__gate,',
  ':host-context(.high-contrast) .community-create__preview,',
  ':host-context(.high-contrast) .community-create__choice,',
  ':host-context(.high-contrast) .community-create__form input,',
  ':host-context(.high-contrast) .community-create__tag {',
  '.community-create__choice.is-selected {',
  '.community-create__tag.is-selected {',
  'border-radius: 999px',
  '!important',
  '.community-create__tag,\n  border-width',
]) {
  if (communityCreateCss.includes(forbidden)) {
    violations.push(
      'community-create-page.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const globalNetworkStatusCss = read(
  'src/app/core/components/global-network-status/global-network-status.component.css'
);
for (const forbidden of [
  'box-shadow:',
  'color: #713f12',
  'background: #fef3c7',
  'color: #14532d',
  'background: #dcfce7',
]) {
  if (globalNetworkStatusCss.includes(forbidden)) {
    violations.push(
      'global-network-status.component.css contains duplicate or hardcoded status chrome ' + forbidden
    );
  }
}

const contentAccessNoticeHtml = read(
  'src/app/shared/components/content-access-notice/content-access-notice.component.html'
);
for (const required of [
  'content-access-notice app-card app-card--flat',
  '[class.app-card--compact]="compact()"',
  'content-access-notice__action app-action app-action--ghost',
]) {
  if (!contentAccessNoticeHtml.includes(required)) {
    violations.push(
      'content-access-notice.component.html missing canonical UI contract ' + required
    );
  }
}

const contentAccessNoticeCss = read(
  'src/app/shared/components/content-access-notice/content-access-notice.component.css'
);
for (const forbidden of [
  'border-radius: 999px',
  '.content-access-notice__action:hover,',
  ':host-context(.high-contrast) .content-access-notice,',
  '@media (prefers-reduced-motion: reduce)',
  'border: 1px solid var(--surface-border',
  'background: var(--surface-color',
]) {
  if (contentAccessNoticeCss.includes(forbidden)) {
    violations.push(
      'content-access-notice.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const contentStateHtml = read(
  'src/app/shared/content-state/content-state.component.html'
);
for (const required of [
  'content-state content-state--loading app-card app-card--flat',
  'content-state app-card app-card--flat',
  '[class.app-card--compact]="compact"',
  'class="visually-hidden"',
]) {
  if (!contentStateHtml.includes(required)) {
    violations.push(
      'content-state.component.html missing canonical UI contract ' + required
    );
  }
}

const contentStateCss = read(
  'src/app/shared/content-state/content-state.component.css'
);
for (const forbidden of [
  '.visually-hidden {',
  'border: 1px solid var(--surface-border',
  'background: var(--surface-color',
  '.content-state--compact {\n  padding: 12px 14px;\n  border-radius:',
]) {
  if (contentStateCss.includes(forbidden)) {
    violations.push(
      'content-state.component.css contains duplicate shared state chrome ' + forbidden
    );
  }
}

const reportContentButtonHtml = read(
  'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component.html'
);
if (!reportContentButtonHtml.includes(
  'report-button report-button--default app-action app-action--danger'
)) {
  violations.push(
    'report-content-button.component.html missing canonical danger action'
  );
}

const reportContentButtonCss = read(
  'src/app/shared/components-globais/moderation-report/report-content-button/report-content-button.component.css'
);
for (const forbidden of [
  'border-radius: 999px',
  '!important',
  '.report-button:focus-visible,',
]) {
  if (reportContentButtonCss.includes(forbidden)) {
    violations.push(
      'report-content-button.component.css contains duplicate action chrome ' + forbidden
    );
  }
}

const reportContentDialogHtml = read(
  'src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.html'
);
for (const required of [
  'report-dialog app-card app-card--media',
  'report-dialog__helper app-card app-card--flat app-card--compact',
  'class="app-action app-action--ghost"',
  'class="app-action app-action--danger"',
]) {
  if (!reportContentDialogHtml.includes(required)) {
    violations.push(
      'report-content-dialog.component.html missing canonical UI contract ' + required
    );
  }
}

const reportContentDialogCss = read(
  'src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.css'
);
for (const forbidden of [
  'border-radius: 999px',
  '!important',
  'html.high-contrast .report-dialog__helper',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (reportContentDialogCss.includes(forbidden)) {
    violations.push(
      'report-content-dialog.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const textoDialogHtml = read(
  'src/app/shared/components-globais/texto-dialog/texto-dialog.component.html'
);
for (const required of [
  'container_text_dialog app-card app-card--media',
  'class="app-action app-action--ghost"',
  'class="app-action app-action--primary"',
]) {
  if (!textoDialogHtml.includes(required)) {
    violations.push(
      'texto-dialog.component.html missing canonical UI contract ' + required
    );
  }
}

const textoDialogCss = read(
  'src/app/shared/components-globais/texto-dialog/texto-dialog.component.css'
);
for (const forbidden of [
  '::ng-deep',
  'box-shadow:',
  '#007bff',
  'button:hover',
  'button[mat-stroked-button]',
  'button[mat-flat-button]',
]) {
  if (textoDialogCss.includes(forbidden)) {
    violations.push(
      'texto-dialog.component.css contains legacy dialog chrome ' + forbidden
    );
  }
}

const modalMensagemHtml = read(
  'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.html'
);
for (const required of [
  'direct-message-dialog app-card app-card--media',
  'direct-message-close app-action app-action--ghost',
  'direct-message-recipient app-card app-card--flat app-card--compact',
]) {
  if (!modalMensagemHtml.includes(required)) {
    violations.push(
      'modal-mensagem.component.html missing canonical UI contract ' + required
    );
  }
}

const modalMensagemCss = read(
  'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.css'
);
for (const forbidden of [
  '.direct-message-close:hover:not(:disabled)',
  'background: var(--modal-background)',
  'border-radius: 999px',
  '.direct-message-submit:hover:not(:disabled)',
]) {
  if (modalMensagemCss.includes(forbidden)) {
    violations.push(
      'modal-mensagem.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const uploadPhotoHtml = read(
  'src/app/shared/components-globais/upload-photo/upload-photo.component.html'
);
for (const required of [
  'upload-modal-content app-card app-card--media',
  'btn-close app-action app-action--ghost',
  'loading-spinner app-card app-card--flat app-card--compact',
  'alert alert-danger mt-2 app-card app-card--flat app-card--compact',
]) {
  if (!uploadPhotoHtml.includes(required)) {
    violations.push(
      'upload-photo.component.html missing canonical UI contract ' + required
    );
  }
}

const uploadPhotoCss = read(
  'src/app/shared/components-globais/upload-photo/upload-photo.component.css'
);
for (const forbidden of [
  'box-shadow:',
  '!important',
  '.btn-close:hover:not(:disabled)',
  ':host-context(html.high-contrast) .upload-modal-content,',
  ':host-context(html.high-contrast) .btn-close,',
]) {
  if (uploadPhotoCss.includes(forbidden)) {
    violations.push(
      'upload-photo.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const mobileBottomNavHtml = read(
  'src/app/shared/components-globais/mobile-bottom-nav/mobile-bottom-nav.component.html'
);
if (!mobileBottomNavHtml.includes(
  'mobile-bottom-nav app-card app-card--flat app-card--media'
)) {
  violations.push(
    'mobile-bottom-nav.component.html missing canonical navigation surface'
  );
}

const mobileBottomNavCss = read(
  'src/app/shared/components-globais/mobile-bottom-nav/mobile-bottom-nav.component.css'
);
for (const forbidden of [
  'linear-gradient(',
  'box-shadow:',
  '!important',
  '@media (prefers-reduced-motion: reduce)',
  'html.high-contrast .mobile-bottom-nav,',
]) {
  if (mobileBottomNavCss.includes(forbidden)) {
    violations.push(
      'mobile-bottom-nav.component.css contains duplicate shared surface chrome ' + forbidden
    );
  }
}

const universalSidebarHtml = read(
  'src/app/shared/components-globais/universal-sidebar/universal-sidebar.component.html'
);
for (const required of [
  'universal-sidebar__action app-action app-action--ghost',
  'universal-sidebar__submenu app-card app-card--flat app-card--media',
]) {
  if (!universalSidebarHtml.includes(required)) {
    violations.push(
      'universal-sidebar.component.html missing canonical UI contract ' + required
    );
  }
}

const universalSidebarCss = read(
  'src/app/shared/components-globais/universal-sidebar/universal-sidebar.component.css'
);
for (const forbidden of [
  '.universal-sidebar__action:hover,',
  'box-shadow: 0 0 0 rgba(0, 0, 0, 0)',
  'box-shadow: 0 8px 18px rgba(255, 77, 87, 0.24)',
  'html.high-contrast .universal-sidebar__action,',
  'html.high-contrast .universal-sidebar__action:hover,',
  '!important',
]) {
  if (universalSidebarCss.includes(forbidden)) {
    violations.push(
      'universal-sidebar.component.css contains duplicate action chrome ' + forbidden
    );
  }
}

const universalSidebarGroupsCss = read(
  'src/app/shared/components-globais/universal-sidebar/universal-sidebar-groups.css'
);
for (const forbidden of [
  'box-shadow: var(--box-shadow)',
  'background: var(--surface-color)',
  'html.high-contrast .universal-sidebar__submenu {',
  '@media (prefers-reduced-motion: reduce)',
  '!important',
]) {
  if (universalSidebarGroupsCss.includes(forbidden)) {
    violations.push(
      'universal-sidebar-groups.css contains duplicate submenu chrome ' + forbidden
    );
  }
}

const confirmationDialogHtml = read(
  'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component.html'
);
for (const required of [
  'confirmation-dialog app-card app-card--media',
  'confirmation-dialog__detail app-card app-card--flat app-card--compact',
  'confirmation-dialog__button confirmation-dialog__button--ghost app-action app-action--ghost',
  '[class.app-action--primary]="tone() !== \'danger\'"',
  '[class.app-action--danger]="tone() === \'danger\'"',
]) {
  if (!confirmationDialogHtml.includes(required)) {
    violations.push(
      'confirmation-dialog.component.html missing canonical UI contract ' + required
    );
  }
}

const confirmationDialogCss = read(
  'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component.css'
);
for (const forbidden of [
  'box-shadow:',
  'linear-gradient(',
  'radial-gradient(',
  'border-radius: 999px',
  '!important',
  '.confirmation-dialog__button:hover',
  ':host-context(.high-contrast)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (confirmationDialogCss.includes(forbidden)) {
    violations.push(
      'confirmation-dialog.component.css contains duplicate global dialog chrome ' + forbidden
    );
  }
}

const preferenceProfileHtml = read(
  'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html'
);
if (!preferenceProfileHtml.includes(
  'preference-upgrade app-card app-card--flat app-card--compact'
)) {
  violations.push(
    'preference-profile-form.component.html missing canonical upgrade surface'
  );
}

const preferenceProfileCss = read(
  'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
);
for (const forbidden of [
  'border-radius: var(--surface-radius-sm',
  'html.high-contrast .preference-upgrade',
]) {
  if (preferenceProfileCss.includes(forbidden)) {
    violations.push(
      'preference-profile-form.component.css contains duplicate upgrade chrome ' + forbidden
    );
  }
}

const notificationSettingsHtml = read(
  'src/app/preferences/pages/notification-settings/notification-settings.component.html'
);
if (!notificationSettingsHtml.includes('class="visually-hidden"')) {
  violations.push(
    'notification-settings.component.html should use canonical visually-hidden helper'
  );
}

const notificationSettingsCss = read(
  'src/app/preferences/pages/notification-settings/notification-settings.component.css'
);
for (const forbidden of [
  '.sr-only {',
  ':host-context(html.high-contrast) .push-device-card,',
  '!important',
]) {
  if (notificationSettingsCss.includes(forbidden)) {
    violations.push(
      'notification-settings.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const preferencesEditorCss = read(
  'src/app/preferences/pages/preferences-editor/preferences-editor.component.css'
);
for (const forbidden of [
  'html.high-contrast .availability-section',
]) {
  if (preferencesEditorCss.includes(forbidden)) {
    violations.push(
      'preferences-editor.component.css contains duplicate disclosure contrast chrome ' + forbidden
    );
  }
}

const intentCss = read(
  'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
);
for (const forbidden of [
  "content: '+'",
  "content: '−'",
  '.form-actions .btn',
]) {
  if (intentCss.includes(forbidden)) {
    violations.push(
      'intent-state-form.component.css contains obsolete local UI chrome ' + forbidden
    );
  }
}

const notificationCss = read(
  'src/app/preferences/pages/notification-settings/notification-settings.component.css'
);
for (const forbidden of [
  '.push-device-card__action--secondary',
  '.notification-settings-state__retry {',
]) {
  if (notificationCss.includes(forbidden)) {
    violations.push(
      'notification-settings.component.css contains duplicate global action chrome ' + forbidden
    );
  }
}

const compatibilityPreviewHtml = read(
  'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html'
);
for (const required of [
  'compatibility-card app-card app-card--flat',
  'compatibility-item app-card app-card--flat app-card--compact',
  'reason-item app-card app-card--flat app-card--compact',
  'compatibility-grid app-responsive-grid',
]) {
  if (!compatibilityPreviewHtml.includes(required)) {
    violations.push(
      'compatibility-preview-card.component.html missing canonical UI contract ' + required
    );
  }
}

const compatibilityPreviewCss = read(
  'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.css'
);
for (const forbidden of [
  'border: 1px solid var(--surface-border',
  'border-radius: 1rem',
  'background: var(--surface-color',
  'background: rgba(255, 255, 255, 0.03)',
]) {
  if (compatibilityPreviewCss.includes(forbidden)) {
    violations.push(
      'compatibility-preview-card.component.css contains duplicate card chrome ' + forbidden
    );
  }
}

const matchProfilePreviewHtml = read(
  'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html'
);
for (const required of [
  'match-profile-card app-card app-card--flat',
  'card-badge app-chip app-chip--muted',
  'card-item app-card app-card--flat app-card--compact',
  'card-grid app-responsive-grid',
]) {
  if (!matchProfilePreviewHtml.includes(required)) {
    violations.push(
      'match-profile-preview-card.component.html missing canonical UI contract ' + required
    );
  }
}

const matchProfilePreviewCss = read(
  'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.css'
);
for (const forbidden of [
  'border: 1px solid var(--surface-border',
  'border-radius: 1rem',
  'border-radius: 999px',
  'background: var(--surface-color',
  'background: rgba(255, 255, 255, 0.03)',
]) {
  if (matchProfilePreviewCss.includes(forbidden)) {
    violations.push(
      'match-profile-preview-card.component.css contains duplicate card/chip chrome ' + forbidden
    );
  }
}

const publicUserPreviewTrigger = read(
  'src/app/core/components/public-user-preview-popover/public-user-preview-trigger.directive.ts'
);
for (const forbidden of [
  'public-user-preview-overlay--desktop',
  'public-user-preview-overlay--touch',
  'panelClass:',
]) {
  if (publicUserPreviewTrigger.includes(forbidden)) {
    violations.push(
      'public-user-preview-trigger.directive.ts contains orphan overlay presentation hook ' + forbidden
    );
  }
}

const publicUserPreviewHtml = read(
  'src/app/core/components/public-user-preview-popover/public-user-preview-popover.component.html'
);
for (const required of [
  'public-user-preview app-card app-card--media',
  'public-user-preview__highlight app-chip app-chip--muted',
  'public-user-preview__profile-link app-action app-action--ghost',
]) {
  if (!publicUserPreviewHtml.includes(required)) {
    violations.push(
      'public-user-preview-popover.component.html missing canonical UI contract ' + required
    );
  }
}

const publicUserPreviewCss = read(
  'src/app/core/components/public-user-preview-popover/public-user-preview-popover.component.css'
);
for (const forbidden of [
  'box-shadow:',
  'border-radius: 999px',
  '.public-user-preview__profile-link:hover,',
  ':host-context(.high-contrast) .public-user-preview {',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (publicUserPreviewCss.includes(forbidden)) {
    violations.push(
      'public-user-preview-popover.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const publicUserIdentityCss = read(
  'src/app/core/components/public-user-identity/public-user-identity.component.css'
);
for (const forbidden of [
  'box-shadow:',
  '!important',
  '.app-card',
  '.app-action',
]) {
  if (publicUserIdentityCss.includes(forbidden)) {
    violations.push(
      'public-user-identity.component.css should remain a lightweight identity primitive without shared chrome ' + forbidden
    );
  }
}

const userCardHtml = read(
  'src/app/shared/user-card/user-card.component.html'
);
for (const required of [
  'user-card app-card app-card--media app-card--interactive',
  'user-card__action user-card__action--primary app-action app-action--primary',
  'user-card__action user-card__action--neutral app-action app-action--ghost',
  'user-card__action user-card__action--danger-subtle app-action app-action--ghost app-action--danger',
  'class="visually-hidden"',
]) {
  if (!userCardHtml.includes(required)) {
    violations.push(
      'user-card.component.html missing canonical UI contract ' + required
    );
  }
}

const userCardCss = read('src/app/shared/user-card/user-card.component.css');
for (const forbidden of [
  'box-shadow: 0 5px 16px',
  'box-shadow: 0 8px 22px',
  '--uc-accent-hover:',
  '.sr-only {',
  '.user-card__action--primary:hover,',
  ':host-context(.dark-mode) .user-card,',
  ':host-context(.high-contrast) .user-card,',
  'html.high-contrast .user-card__body',
  'color: var(--text-color) !important',
]) {
  if (userCardCss.includes(forbidden)) {
    violations.push(
      'user-card.component.css contains duplicate shared UI chrome ' + forbidden
    );
  }
}

const discoveryModeTabsHtml = read(
  'src/app/dashboard/discovery/discovery-mode-tabs/discovery-mode-tabs.component.html'
);
for (const required of [
  'discovery-tabs app-segmented',
  'discovery-tabs__item app-segmented__button',
  'app-segmented__button--active',
]) {
  if (!discoveryModeTabsHtml.includes(required)) {
    violations.push(
      'discovery-mode-tabs.component.html missing canonical segmented contract ' + required
    );
  }
}

const discoveryModeTabsCss = read(
  'src/app/dashboard/discovery/discovery-mode-tabs/discovery-mode-tabs.component.css'
);
for (const forbidden of [
  '--tabs-border:',
  '--tabs-text:',
  '--tabs-active:',
  '.discovery-tabs__item:hover:not(:disabled)',
  ':host-context(.dark-mode)',
  ':host-context(.high-contrast)',
  '@media (prefers-reduced-motion: reduce)',
]) {
  if (discoveryModeTabsCss.includes(forbidden)) {
    violations.push(
      'discovery-mode-tabs.component.css contains duplicate segmented UI chrome ' + forbidden
    );
  }
}

const profilesDiscoveryHtml = read(
  'src/app/dashboard/discovery/profiles-discovery-page/profiles-discovery-page.component.html'
);
for (const required of [
  'profiles-discovery-page__location-notice app-card app-card--flat app-card--compact',
  'profiles-discovery-page__location-action app-action app-action--primary',
  'profiles-discovery-page__location-dismiss app-action app-action--ghost',
]) {
  if (!profilesDiscoveryHtml.includes(required)) {
    violations.push(
      'profiles-discovery-page.component.html missing canonical UI contract ' + required
    );
  }
}

const publicProfilesHtml = read(
  'src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.html'
);
for (const required of [
  'public-profiles__grid app-responsive-grid',
  'public-profiles__retry app-action app-action--ghost',
  'public-profiles__load-more app-action app-action--ghost',
  'public-profiles__review app-action app-action--ghost',
]) {
  if (!publicProfilesHtml.includes(required)) {
    violations.push(
      'public-profiles-list.component.html missing canonical UI contract ' + required
    );
  }
}

const publicProfilesCss = read(
  'src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.css'
);
for (const forbidden of [
  '.sr-only {',
  '.public-profiles__retry:hover,',
  'grid-template-columns: repeat(auto-fit, minmax(236px, 1fr))',
  ':host-context(.high-contrast) .public-profiles__retry,',
]) {
  if (publicProfilesCss.includes(forbidden)) {
    violations.push(
      'public-profiles-list.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const socialExploreHtml = read(
  'src/app/explore/pages/social-explore-page/social-explore-page.component.html'
);
for (const required of [
  'feed-composer__moment app-action app-action--ghost',
  'video-highlights__error app-card app-card--flat app-card--compact',
  'community-distribution__card app-card app-card--flat app-card--compact app-card--interactive',
  'community-distribution__priority app-chip app-chip--primary',
  'feed-intent app-card app-card--flat app-card--compact',
  'community-distribution__header app-section-header',
]) {
  if (!socialExploreHtml.includes(required)) {
    violations.push(
      'social-explore-page.component.html missing canonical UI contract ' + required
    );
  }
}

const socialExploreCss = read(
  'src/app/explore/pages/social-explore-page/social-explore-page.component.css'
);
for (const forbidden of [
  'color: var(--primary-color, #ff7070) !important',
  'font-size: 0.62rem !important',
  'font-weight: 780 !important',
  'letter-spacing: 0 !important',
  'text-transform: none !important',
  ':host-context(html.high-contrast) .feed-composer,',
  '.feed-pagination button {',
]) {
  if (socialExploreCss.includes(forbidden)) {
    violations.push(
      'social-explore-page.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const communityPreviewHtml = read(
  'src/app/community/preview/community-preview-page.component.html'
);
for (const required of [
  'community-preview__content app-card app-card--flat app-card--media',
  'community-preview__membership-action app-action app-action--primary',
  'community-preview__membership-leave-action app-action app-action--ghost',
  'community-preview__lifecycle app-card app-card--flat app-card--compact',
  'community-preview__rail-card app-card app-card--flat app-card--compact',
  'class="app-action app-action--ghost"\n                    id="community-tab-requests"',
]) {
  if (!communityPreviewHtml.includes(required)) {
    violations.push(
      'community-preview-page.component.html missing canonical UI contract ' + required
    );
  }
}

const communityPreviewCss = read(
  'src/app/community/preview/community-preview-page.component.css'
);
for (const forbidden of [
  'box-shadow: 0 0.2rem 0.7rem',
  'border-radius: var(--radius-lg',
  '.community-preview__management-actions button {',
  '.community-preview__rail-card > button,',
  '.community-preview__membership-action {\n  border: 0;',
  ':host-context(.high-contrast) .community-preview__rail-card,',
]) {
  if (communityPreviewCss.includes(forbidden)) {
    violations.push(
      'community-preview-page.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const communityDiscoveryHtml = read(
  'src/app/community/discovery/community-discovery-page.component.html'
);
for (const required of [
  'community-discovery__filter-chip app-action app-action--ghost',
  'community-discovery__filter-retry app-action app-action--ghost',
  'community-card__notification-action app-action app-action--ghost',
  'community-card__dismiss app-action app-action--ghost',
  'community-card__sponsorship app-chip app-chip--muted',
  'community-card__contextual-match app-chip app-chip--primary',
]) {
  if (!communityDiscoveryHtml.includes(required)) {
    violations.push(
      'community-discovery-page.component.html missing canonical UI contract ' + required
    );
  }
}

const communityDiscoveryCss = read(
  'src/app/community/discovery/community-discovery-page.component.css'
);
for (const forbidden of [
  'box-shadow: 0 8px 24px',
  'transform: translateY(-2px)',
  'border-radius: var(--radius-lg',
  '.community-discovery__filter-control select {\n  width: min(10.25rem, 46vw);\n  min-height: 2.45rem',
  '.community-discovery__filter-chip {\n  flex: 0 0 auto;\n  min-height: 2.45rem',
  '.community-discovery__filter-retry {\n  min-height: 2.45rem',
]) {
  if (communityDiscoveryCss.includes(forbidden)) {
    violations.push(
      'community-discovery-page.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const onlineUsersHtml = read(
  'src/app/dashboard/online/online-users/online-users.component.html'
);
for (const required of [
  'online-users__activation app-card app-card--flat',
  'online-users__toolbar app-toolbar',
  'online-users__toggle app-action app-action--ghost',
  'online-users__controls app-card app-card--flat',
  'online-users__refresh app-action app-action--ghost',
  'online-users__step app-action app-action--ghost',
  'profiles-grid app-responsive-grid',
]) {
  if (!onlineUsersHtml.includes(required)) {
    violations.push(
      'online-users.component.html missing canonical UI contract ' + required
    );
  }
}

const onlineUsersCss = read(
  'src/app/dashboard/online/online-users/online-users.component.css'
);
for (const forbidden of [
  '--ou-border:',
  '--ou-surface:',
  'box-shadow: 0 8px 20px',
  'border-radius: 16px',
  'grid-template-columns: 42px minmax(0, 1fr) 42px',
  '.online-users__step {\n    width: 42px',
  '.online-users__step {\n    height: 42px',
]) {
  if (onlineUsersCss.includes(forbidden)) {
    violations.push(
      'online-users.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const principalHtml = read(
  'src/app/dashboard/principal/principal.component.html'
);
for (const required of [
  'feed-create-bar app-card app-card--flat',
  'profile-checklist app-card app-card--flat',
  'social-space-card app-card app-card--flat app-card--media',
  'connections-feed__toggle app-action app-action--ghost',
  'feed-action app-action app-action--primary',
]) {
  if (!principalHtml.includes(required)) {
    violations.push(
      'principal.component.html missing canonical UI contract ' + required
    );
  }
}

const principalCss = read(
  'src/app/dashboard/principal/principal.component.css'
);
for (const forbidden of [
  'box-shadow: 0 6px 18px',
  'border-radius: 17px',
  'min-height: 34px',
  'min-height: 36px',
  'width: 42px',
  'height: 40px',
]) {
  if (principalCss.includes(forbidden)) {
    violations.push(
      'principal.component.css contains duplicate local UI chrome ' + forbidden
    );
  }
}

const subscriptionPlanHtml = read(
  'src/app/subscriptions/subscription-plan/subscription-plan.component.html'
);
for (const required of [
  'plans-grid app-responsive-grid',
  'app-card app-card--flat',
  'app-action app-action--primary',
]) {
  if (!subscriptionPlanHtml.includes(required)) {
    violations.push(
      'subscription-plan.component.html missing canonical UI contract ' + required
    );
  }
}

const subscriptionPlanCss = read(
  'src/app/subscriptions/subscription-plan/subscription-plan.component.css'
);
for (const forbidden of [
  'linear-gradient(',
  'box-shadow:',
  'border-radius: 24px',
  '.app-action-secondary',
  'transform: translateY(-2px)',
]) {
  if (subscriptionPlanCss.includes(forbidden)) {
    violations.push(
      'subscription-plan.component.css contains duplicate local UI chrome ' + forbidden
    );
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
  '[ui-section-hierarchy] OK: canonical page/section/disclosure hierarchy is preserved without redundant profile, media, community or preference copy.'
);
