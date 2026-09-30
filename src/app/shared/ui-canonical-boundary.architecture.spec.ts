import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  join,
  relative,
  resolve,
} from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function hasClassToken(value: string, token: string): boolean {
  for (const match of value.matchAll(/class=["']([^"']*)["']/gu)) {
    if ((match[1] ?? '').split(/\s+/u).includes(token)) {
      return true;
    }
  }

  return false;
}

function productionHtmlFiles(root: string): readonly string[] {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(absolute);
      }
    }
  };

  visit(root);
  return files;
}

const CANONICAL_ACTION_TEMPLATES = [
  'src/app/account/pages/account-home/account-home.component.html',
  'src/app/authentication/login-component/login-component.html',
  'src/app/register-module/register.component.html',
  'src/app/preferences/pages/preferences-editor/preferences-editor.component.html',
  'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
  'src/app/preferences/pages/discovery-settings/discovery-settings.component.html',
  'src/app/preferences/pages/notification-settings/notification-settings.component.html',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.html',
  'src/app/media/photos/photo-upload/photo-upload.component.html',
  'src/app/community/discovery/community-discovery-page.component.html',
  'src/app/subscriptions/subscription-plan/subscription-plan.component.html',
  'src/app/explore/pages/social-explore-page/social-explore-page.component.html',
  'src/app/user-profile/user-profile-view/user-profile-view.component.html',
  'src/app/notifications/notifications-page/notifications-page.component.html',
  'src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.html',
  'src/app/subscriptions/checkout/checkout.component.html',
  'src/app/media/photos/profile-photos/profile-photos.component.html',
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
] as const;

const CANONICAL_HEADER_TEMPLATES = [
  'src/app/preferences/pages/preferences-editor/preferences-editor.component.html',
  'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
  'src/app/preferences/pages/discovery-settings/discovery-settings.component.html',
  'src/app/preferences/pages/notification-settings/notification-settings.component.html',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.html',
  'src/app/media/photos/photo-upload/photo-upload.component.html',
  'src/app/community/discovery/community-discovery-page.component.html',
  'src/app/subscriptions/subscription-plan/subscription-plan.component.html',
  'src/app/notifications/notifications-page/notifications-page.component.html',
  'src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.html',
  'src/app/subscriptions/checkout/checkout.component.html',
  'src/app/media/photos/profile-photos/profile-photos.component.html',
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
] as const;

const CANONICALIZED_STYLES = [
  'src/app/authentication/login-component/login-component.css',
  'src/app/register-module/register.component.css',
  'src/app/preferences/pages/preferences-editor/preferences-editor.component.css',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.css',
  'src/app/media/photos/photo-upload/photo-upload.component.css',
  'src/app/community/discovery/community-discovery-page.component.css',
  'src/app/subscriptions/subscription-plan/subscription-plan.component.css',
  'src/app/explore/pages/social-explore-page/social-explore-page.component.css',
  'src/app/user-profile/user-profile-view/user-profile-view.component.css',
  'src/app/notifications/notifications-page/notifications-page.component.css',
  'src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.css',
  'src/app/subscriptions/checkout/checkout.component.css',
  'src/app/media/photos/profile-photos/profile-photos.component.css',
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.css',
  'src/app/media/photos/top-public-photos/top-public-photos.component.css',
] as const;

describe('Canonical UI boundary', () => {
  it('não reintroduz a classe genérica legada btn nas superfícies migradas', () => {
    const violations = CANONICAL_ACTION_TEMPLATES.filter((path) =>
      hasClassToken(source(path), 'btn')
    );

    expect(
      violations,
      'Ações genéricas devem usar app-action.'
    ).toEqual([]);
  });

  it('mantém PageHeader como autoridade das páginas migradas', () => {
    const violations = CANONICAL_HEADER_TEMPLATES.flatMap((path) => {
      const value = source(path);
      const issues: string[] = [];

      if (!value.includes('<app-page-header')) {
        issues.push(`${path}: sem app-page-header`);
      }

      if (/<h1\b/iu.test(value)) {
        issues.push(`${path}: voltou a declarar h1 local`);
      }

      return issues;
    });

    expect(
      violations,
      'Páginas migradas devem usar o PageHeader compartilhado.'
    ).toEqual([]);
  });

  it('não reintroduz seletor CSS .btn genérico nas superfícies migradas', () => {
    const violations = CANONICALIZED_STYLES.filter((path) =>
      /\.btn(?=[\s,{.:>#\[])/u.test(source(path))
    );

    expect(
      violations,
      'CSS local não deve redesenhar a ação genérica legada .btn.'
    ).toEqual([]);
  });

  it('preserva remoções estruturais já concluídas', () => {
    const removedPaths = [
      'src/app/preferences/pages/preferences-home/preferences-home.component.ts',
      'src/app/preferences/pages/preferences-home/preferences-home.component.html',
      'src/app/preferences/pages/preferences-home/preferences-home.component.css',
      'src/app/preferences/components/preferences-page-header/preferences-page-header.component.ts',
      'src/app/preferences/components/preferences-page-header/preferences-page-header.component.html',
      'src/app/preferences/components/preferences-page-header/preferences-page-header.component.css',
      'src/app/notifications/notifications-page/notifications-page.clean.css',
      'src/app/user-profile/user-profile-edit/edit-region/edit-profile-region.component.ts',
      'src/app/user-profile/user-profile-edit/edit-region/edit-profile-region.component.html',
      'src/app/user-profile/user-profile-edit/edit-region/edit-profile-region.component.css',
      'src/app/user-profile/user-profile-edit/edit-region/edit-profile-region.component.spec.ts',
      'src/app/chat-module/communities/communities.module.ts',
      'src/app/chat-module/communities/communities-routing.module.ts',
      'src/app/dashboard/featured-profiles/featured-profiles.component.ts',
      'src/app/dashboard/featured-profiles/featured-profiles.component.html',
      'src/app/dashboard/featured-profiles/featured-profiles.component.spec.ts',
      'src/app/chat-module/chat-window/chat-window.component.ts',
      'src/app/chat-module/chat-window/chat-window.component.html',
      'src/app/chat-module/chat-window/chat-window.component.css',
      'src/app/chat-module/chat-window/chat-window.component.spec.ts',
      'src/app/footer/contact-footer/contact-footer.component.css',
      'src/app/footer/footer/footer.component.css',
      'src/app/footer/navigation-footer/navigation-footer.component.css',
      'src/app/authentication/progressive-signup/progressive-signup.component.ts',
      'src/app/authentication/progressive-signup/progressive-signup.component.html',
      'src/app/authentication/progressive-signup/progressive-signup.component.css',
      'src/app/authentication/progressive-signup/progressive-signup.component.spec.ts',
      'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.ts',
      'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.html',
      'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.css',
      'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component.spec.ts',
    ];

    expect(
      removedPaths.filter((item) => existsSync(resolve(ROOT, item))),
      'Componentes consolidados não devem reaparecer.'
    ).toEqual([]);
  });

  it('mantém ConfirmationDialog como única confirmação global compartilhada', () => {
    const sharedModule = source('src/app/shared/shared.module.ts');

    expect(sharedModule).toContain('ConfirmationDialogComponent');
    expect(sharedModule).not.toContain('ConfirmacaoDialogComponent');
    expect(sharedModule).not.toContain('components-globais/confirmacao-dialog');
  });

  it('não permite novos placeholders works! em templates de produção', () => {
    const appRoot = resolve(ROOT, 'src/app');
    const violations = productionHtmlFiles(appRoot)
      .filter((file) => /\bworks!\b/iu.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'Templates placeholder devem ser removidos ou substituídos.'
    ).toEqual([]);
  });

  it('mantém Preferências dentro do RegisterFlow canônico sem fluxo paralelo', () => {
    const navigation = source(
      'src/app/register-module/data-access/register-navigation.service.ts'
    );
    const postAuth = source(
      'src/app/register-module/data-access/post-auth-navigation.service.ts'
    );
    const authRoutes = source(
      'src/app/authentication/authentication-routing.module.ts'
    );

    expect(navigation).toContain("currentStep: 'preferences'");
    expect(navigation).toContain('/preferencias/editar/');
    expect(postAuth).toContain("case 'preferences':");
    expect(authRoutes).not.toContain('progressive-signup');
  });

  it('não reintroduz o composer legado ChatWindowComponent', () => {
    const chatModule = source('src/app/chat-module/chat-module.ts');

    expect(chatModule).not.toContain('ChatWindowComponent');
    expect(chatModule).not.toContain(
      './chat-window/chat-window.component'
    );
  });

  it('mantém a política de cookies ligada à fonte legal canônica', () => {
    const component = source(
      'src/app/footer/legal-footer/politica-de-cookies/politica-de-cookies.component.ts'
    );
    const template = source(
      'src/app/footer/legal-footer/politica-de-cookies/politica-de-cookies.component.html'
    );
    const legalConstants = source(
      'src/app/core/services/compliance/platform-legal.constants.ts'
    );

    expect(component).toContain('PLATFORM_LEGAL_MANIFEST');
    expect(template).toContain('cookieNoticeVersion');
    expect(template).toContain('cookieNoticeEffectiveDateLabel');
    expect(legalConstants).toContain('COOKIE_NOTICE_VERSION');
    expect(template).not.toContain('works!');
  });

  it('mantém as primitives globais que sustentam a canonização', () => {
    const forms = source('src/styles/global-forms.css');
    const cards = source('src/styles/cards.css');

    for (const selector of [
      '.app-field {',
      '.app-control {',
      '.app-choice {',
      '.app-toggle {',
      '.app-form-actions {',
    ]) {
      expect(forms).toContain(selector);
    }

    for (const selector of [
      '.app-action {',
      '.app-card {',
      '.app-disclosure {',
      '.app-page-header {',
      '.app-responsive-grid {',
    ]) {
      expect(cards).toContain(selector);
    }
  });
});
