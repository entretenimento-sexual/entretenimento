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
  'html.high-contrast .universal-sidebar__action,',
  'html.high-contrast .universal-sidebar__action:hover,',
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
