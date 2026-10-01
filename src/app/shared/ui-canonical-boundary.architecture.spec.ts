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
  'src/app/chat-module/chat-messages-list/chat-messages-list.component.html',
  'src/app/chat-module/chat-module-layout/chat-module-layout.component.html',
  'src/app/compliance/age-reverification-page/age-reverification-page.component.html',
  'src/app/compliance/age-verification-page/age-verification-page.component.html',
  'src/app/compliance/adult-consent-page/adult-consent-page.component.html',
  'src/app/account/pages/account-home/account-home.component.html',
  'src/app/account/pages/legal-documents/legal-documents.component.html',
  'src/app/account/pages/compliance-cases/compliance-cases.component.html',
  'src/app/account/pages/account-manage/account-manage.component.html',
  'src/app/account/pages/account-security/account-security.component.html',
  'src/app/account/pages/account-subscription/account-subscription.component.html',
  'src/app/account/pages/account-status/account-status.component.html',
  'src/app/account/pages/subscription-history/subscription-history.component.html',
  'src/app/account/pages/account-privilege-history/account-privilege-history.component.html',
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
  'src/app/compliance/age-reverification-page/age-reverification-page.component.html',
  'src/app/compliance/age-verification-page/age-verification-page.component.html',
  'src/app/compliance/adult-consent-page/adult-consent-page.component.html',
  'src/app/safety/safety-center/safety-center.component.html',
  'src/app/layout/friend-management/friend-search/friend-search.component.html',
  'src/app/layout/friend-management/friend-blocked/friend-blocked.component.html',
  'src/app/layout/friend-management/friend-settings/friend-settings.component.html',
  'src/app/layout/friend-management/friend-list-page/friend-list-page.component.html',
  'src/app/layout/friend-management/friend-requests/friend-requests.component.html',
  'src/app/account/pages/legal-documents/legal-documents.component.html',
  'src/app/account/pages/compliance-cases/compliance-cases.component.html',
  'src/app/account/pages/account-status/account-status.component.html',
  'src/app/account/pages/subscription-history/subscription-history.component.html',
  'src/app/account/pages/account-privilege-history/account-privilege-history.component.html',
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
  'src/app/chat-module/chat-list/chat-list.component.css',
  'src/app/chat-module/chat-messages-list/chat-messages-list.component.css',
  'src/app/chat-module/chat-module-layout/chat-module-layout.component.css',
  'src/app/compliance/age-reverification-page/age-reverification-page.component.css',
  'src/app/compliance/age-verification-page/age-verification-page.component.css',
  'src/app/compliance/adult-consent-page/adult-consent-page.component.css',
  'src/app/safety/safety-center/safety-center.component.css',
  'src/app/layout/friend-management/friend-search/friend-search.component.css',
  'src/app/layout/friend-management/friend-blocked/friend-blocked.component.css',
  'src/app/layout/friend-management/friend-settings/friend-settings.component.css',
  'src/app/layout/friend-management/friend-list-page/friend-list-page.component.css',
  'src/app/layout/friend-management/friend-requests/friend-requests.component.css',
  'src/app/account/pages/legal-documents/legal-documents.component.css',
  'src/app/account/pages/compliance-cases/compliance-cases.component.css',
  'src/app/account/pages/account-status/account-status.component.css',
  'src/app/account/pages/subscription-history/subscription-history.component.css',
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

  it('mantém o overview de Conta no grid intrínseco canônico', () => {
    const template = source(
      'src/app/account/pages/account-home/account-home.component.html'
    );
    const styles = source(
      'src/app/account/pages/account-section.css'
    );

    expect(template).toContain('account-overview-grid app-responsive-grid');
    expect(styles).not.toContain('.account-overview-grid {\n    grid-template-columns:');
  });

  it('não reintroduz ações paralelas de suporte em Conta', () => {
    const subscription = source(
      'src/app/account/pages/account-subscription/account-subscription.component.html'
    );
    const security = source(
      'src/app/account/pages/account-security/account-security.component.html'
    );
    const styles = source(
      'src/app/account/pages/account-section.css'
    );

    expect(subscription).not.toContain('account-support-link');
    expect(security).not.toContain('account-support-link');
    expect(styles).not.toContain('.account-support-link');
  });

  it('mantém hero e estados principais de Conta apoiados em primitives globais', () => {
    const subscription = source(
      'src/app/account/pages/account-subscription/account-subscription.component.html'
    );
    const home = source(
      'src/app/account/pages/account-home/account-home.component.html'
    );

    expect(subscription).toContain(
      'account-plan-hero app-card app-card--flat'
    );
    expect(home).toContain('<app-content-state');
  });

  it('mantém Documentos legais e Conformidade nas primitives compartilhadas', () => {
    const legal = source(
      'src/app/account/pages/legal-documents/legal-documents.component.html'
    );
    const compliance = source(
      'src/app/account/pages/compliance-cases/compliance-cases.component.html'
    );
    const legalStyles = source(
      'src/app/account/pages/legal-documents/legal-documents.component.css'
    );
    const complianceStyles = source(
      'src/app/account/pages/compliance-cases/compliance-cases.component.css'
    );

    expect(legal).toContain('<app-page-header');
    expect(legal).toContain('document-grid app-responsive-grid');
    expect(legal).toContain('document-card app-card app-card--flat app-card--interactive');

    expect(compliance).toContain('<app-page-header');
    expect(compliance).toContain('<app-content-state');
    expect(compliance).toContain('class="app-control"');
    expect(compliance).toContain('class="app-action app-action--primary"');

    expect(legalStyles).not.toContain('.legal-center h1');
    expect(complianceStyles).not.toContain('.compliance-button');
    expect(complianceStyles).not.toContain('.compliance-state');
  });

  it('mantém Friends usando header e estados canônicos', () => {
    const list = source(
      'src/app/layout/friend-management/friend-list-page/friend-list-page.component.html'
    );
    const requests = source(
      'src/app/layout/friend-management/friend-requests/friend-requests.component.html'
    );
    const requestStyles = source(
      'src/app/layout/friend-management/friend-requests/friend-requests.component.css'
    );

    expect(list).toContain('<app-page-header');
    expect(requests).toContain('<app-page-header');
    expect(requests).toContain('<app-content-state');
    expect(requests).not.toContain('friend-requests__state');
    expect(requestStyles).not.toContain('.friend-requests__state');
    expect(requestStyles).not.toContain('.friend-requests__loader');
  });

  it('mantém Friends sem erro manual e sem input de rota fantasma', () => {
    const search = source(
      'src/app/layout/friend-management/friend-search/friend-search.component.ts'
    );
    const settings = source(
      'src/app/layout/friend-management/friend-settings/friend-settings.component.ts'
    );
    const blocked = source(
      'src/app/layout/friend-management/friend-blocked/friend-blocked.component.ts'
    );

    expect(search).toContain('ApplicationErrorService');
    expect(search).not.toContain('GlobalErrorHandlerService');
    expect(settings).toContain('ApplicationErrorService');
    expect(settings).not.toContain('GlobalErrorHandlerService');
    expect(blocked).toContain('AuthSessionService');
    expect(blocked).not.toContain('input.required');
  });

  it('mantém Safety e Compliance sem regressão de UI ou erro manual', () => {
    const safety = source(
      'src/app/safety/safety-center/safety-center.component.html'
    );
    const safetyStyles = source(
      'src/app/safety/safety-center/safety-center.component.css'
    );
    const adultConsent = source(
      'src/app/compliance/adult-consent-page/adult-consent-page.component.ts'
    );
    const reverification = source(
      'src/app/compliance/age-reverification-page/age-reverification-page.component.ts'
    );

    expect(safety).toContain('<app-page-header');
    expect(safety).toContain('safety-center__action-grid app-responsive-grid');
    expect(safety).toContain('safety-center__guide-grid app-responsive-grid');
    expect(safetyStyles).not.toContain('.safety-center h1');
    expect(safetyStyles).not.toContain('.safety-center__hero');

    expect(adultConsent).toContain('ApplicationErrorService');
    expect(reverification).toContain('ApplicationErrorService');
    expect(reverification).not.toContain('errorDetail(error');
  });

  it('mantém as páginas de maioridade na camada visual canônica', () => {
    const consent = source(
      'src/app/compliance/adult-consent-page/adult-consent-page.component.html'
    );
    const verification = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.html'
    );
    const reverification = source(
      'src/app/compliance/age-reverification-page/age-reverification-page.component.html'
    );
    const consentStyles = source(
      'src/app/compliance/adult-consent-page/adult-consent-page.component.css'
    );
    const verificationStyles = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.css'
    );
    const reverificationStyles = source(
      'src/app/compliance/age-reverification-page/age-reverification-page.component.css'
    );

    for (const template of [consent, verification, reverification]) {
      expect(template).toContain('<app-page-header');
      expect(template).toContain('app-card app-card--flat');
      expect(template).toContain('app-action');
      expect(template).not.toMatch(/<h1\b/iu);
    }

    expect(reverification).toContain('class="app-control"');
    expect(reverification).toContain('app-choice app-choice--roomy');
    expect(reverification).toContain('app-field-error');

    expect(consentStyles).not.toContain('.adult-consent__button');
    expect(verification).toContain(
      'age-verification__secondary-grid app-responsive-grid'
    );
    expect(verificationStyles).not.toContain('.age-verification__primary');
    expect(verificationStyles).not.toContain('.age-verification__secondary');
    expect(verificationStyles).not.toContain('.age-verification__steps');
    expect(verificationStyles).not.toContain('.age-verification__how-grid');
    expect(reverificationStyles).not.toContain('.age-reverification__primary');
    expect(reverificationStyles).not.toContain('.age-reverification__secondary');
  });

  it('mantém o chat direto sem UI e erros legados de Rooms', () => {
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.html'
    );
    const layoutTs = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const thread = source(
      'src/app/chat-module/chat-messages-list/chat-messages-list.component.html'
    );
    const threadTs = source(
      'src/app/chat-module/chat-messages-list/chat-messages-list.component.ts'
    );
    const listStyles = source(
      'src/app/chat-module/chat-list/chat-list.component.css'
    );

    expect(layout).toContain('<app-content-state');
    expect(layout).toContain('class="app-control"');
    expect(layout).not.toContain('/chat/rooms');
    expect(layout).not.toMatch(/class=["'][^"']*\bbtn\b/u);

    expect(thread).toContain('<app-content-state');
    expect(thread).toContain('app-action');

    expect(layoutTs).toContain('ApplicationErrorService');
    expect(layoutTs).not.toContain('GlobalErrorHandlerService');
    expect(threadTs).toContain('ApplicationErrorService');
    expect(threadTs).not.toContain('GlobalErrorHandlerService');

    expect(listStyles).not.toContain('room-card');
  });

  it('mantém a policy do composer fora do ChatModuleLayoutComponent', () => {
    const layoutTs = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const policy = source(
      'src/app/chat-module/policies/direct-chat-composer.policy.ts'
    );

    expect(layoutTs).toContain('direct-chat-composer.policy');
    expect(layoutTs).not.toContain(
      'private resolveDirectMessageBlockMessage'
    );
    expect(layoutTs).not.toContain('readonly maxMessageLength = 1000');
    expect(policy).toContain('DIRECT_CHAT_MAX_MESSAGE_LENGTH');
    expect(policy).toContain('resolveDirectMessageBlockMessage');
  });

  it('mantém navegação e resolução de peer fora do ChatModuleLayoutComponent', () => {
    const layoutTs = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const orchestrator = source(
      'src/app/chat-module/application/direct-chat-navigation.orchestrator.ts'
    );

    expect(layoutTs).toContain('DirectChatNavigationOrchestrator');
    expect(layoutTs).not.toContain('DirectChatService');
    expect(layoutTs).not.toContain('FirestoreUserQueryService');
    expect(layoutTs).not.toContain('appliedDeepLinkKey');
    expect(layoutTs).not.toContain('ChatDeepLinkPayload');

    expect(orchestrator).toContain('observeResolvedDeepLinks, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
    expect(orchestrator).toContain('consumeDeepLinkQueryParams');
    expect(orchestrator).toContain('resolvePeer, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
  });

  it('mantém autorização preventiva do composer fora do ChatModuleLayoutComponent', () => {
    const layoutTs = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const facade = source(
      'src/app/chat-module/application/direct-chat-compose-access.facade.ts'
    );

    expect(layoutTs).toContain('DirectChatComposeAccessFacade');
    expect(layoutTs).not.toContain('AccessControlService');
    expect(layoutTs).not.toContain('FriendshipService');
    expect(layoutTs).not.toContain('hasAcceptedDirectConnection, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
    expect(layoutTs).not.toContain('canSendCurrentMessage, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);

    expect(facade).toContain('AccessControlService');
    expect(facade).toContain('FriendshipService');
    expect(facade).toContain('DirectThreadFacade');
    expect(facade).toContain('canSendCurrentMessage');
  });

  it('mantém falhas de envio direto observáveis até o shell', () => {
    const service = source(
      'src/app/messaging/direct-chat/services/direct-thread.service.ts'
    );
    const facade = source(
      'src/app/messaging/direct-chat/application/direct-thread.facade.ts'
    );
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );

    const facadeSend = facade
      .split('sendMessage$(content: string)')[1]
      ?.split('deleteMessage$(messageId: string)')[0] ?? '';

    expect(service).toContain('return throwError(() => error);');
    expect(facadeSend).not.toContain('catchError');
    expect(layout).toContain(
      'this.directMessageBlockedReason.set(blockedMessage);'
    );
  });

  it('mantém o comando de envio fora do ChatModuleLayoutComponent', () => {
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const orchestrator = source(
      'src/app/chat-module/application/direct-chat-send.orchestrator.ts'
    );

    expect(layout).toContain('DirectChatSendOrchestrator');
    expect(layout).not.toContain('DirectThreadFacade');
    expect(layout).not.toContain('sendDirectMessage$(');
    expect(layout).not.toContain('resolveDirectMessageBlockMessage');

    expect(orchestrator).toContain('DirectChatFacade');
    expect(orchestrator).toContain('DirectThreadFacade');
    expect(orchestrator).toContain('resolveDirectMessageBlockMessage');
  });

  it('mantém seleção e contexto do peer fora do ChatModuleLayoutComponent', () => {
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const facade = source(
      'src/app/chat-module/application/direct-chat-selection-context.facade.ts'
    );

    expect(layout).toContain('DirectChatSelectionContextFacade');
    expect(layout).not.toContain('selectedChatIdSignal');
    expect(layout).not.toContain('selectedTypeSignal');
    expect(layout).not.toContain('activeChatPeerUidSignal');
    expect(layout).not.toContain('applySelection(');
    expect(layout).not.toContain('applyActiveChatPeer(');

    expect(facade).toContain('DirectChatFacade');
    expect(facade).toContain('selectedDirectPeerUid$(');
    expect(facade).toContain('syncPeerContext$(');
    expect(facade).toContain('selectEvent(');
    expect(facade).toContain('resolvePeer$(');
  });

  it('mantém observadores mortos fora do shell de chat', () => {
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );

    expect(layout).not.toContain('CurrentUserStoreService');
    expect(layout).not.toContain('IUserDados');
    expect(layout).not.toContain('observeRouteUserId');
    expect(layout).not.toContain('observeSelectedDirectPeerFallback');
    expect(layout).not.toContain('resolveActiveChatPeerFromUid');
  });

  it('mantém DirectThreadFacade no pipeline canônico de erros', () => {
    const facade = source(
      'src/app/messaging/direct-chat/application/direct-thread.facade.ts'
    );

    expect(facade).toContain('ApplicationErrorService');
    expect(facade).not.toContain('GlobalErrorHandlerService');
    expect(facade).toContain("presentation: { surface: 'none', severity: 'error' }");
  });

  it('mantém messaging/direct-chat sem GlobalErrorHandlerService manual', () => {
    const directThread = source(
      'src/app/messaging/direct-chat/application/direct-thread.facade.ts'
    );
    const directReceipts = source(
      'src/app/messaging/direct-chat/services/direct-receipts.service.ts'
    );

    expect(directThread).toContain('ApplicationErrorService');
    expect(directReceipts).toContain('ApplicationErrorService');
    expect(directThread).not.toContain('GlobalErrorHandlerService');
    expect(directReceipts).not.toContain('GlobalErrorHandlerService');
  });

  it('mantém perfil alheio nas primitives visuais canônicas', () => {
    const template = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.html'
    );
    const styles = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.css'
    );

    expect(template).toContain('<app-content-state');
    expect(template).toContain('app-action app-action--primary');
    expect(template).toContain('app-card app-card--flat');
    expect(template).toContain('app-chip');

    expect(styles).not.toContain('.other-profile-page__action {');
    expect(styles).not.toContain('.other-profile-page__loading-dot');
    expect(styles).not.toContain('@keyframes other-profile-pulse');
  });

  it('mantém amizade e chat direto fora do perfil alheio', () => {
    const component = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
    );
    const friendship = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-friendship.facade.ts'
    );
    const interactions = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-interaction.orchestrator.ts'
    );

    expect(component).toContain('VisitedProfileFriendshipFacade');
    expect(component).toContain('VisitedProfileInteractionOrchestrator');
    expect(component).not.toContain('FriendRequest');
    expect(component).not.toContain('watchOutboundRequests');
    expect(component).not.toContain('watchFriends');
    expect(component).not.toContain('DirectChatService');

    expect(friendship).toContain('FriendshipService');
    expect(interactions).toContain('FriendshipService');
    expect(interactions).toContain('DirectChatService');
  });

  it('mantém status temporário fora do perfil alheio', () => {
    const component = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
    );
    const facade = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-intent-context.facade.ts'
    );

    expect(component).toContain('VisitedProfileIntentContextFacade');
    expect(component).not.toContain('UserIntentStatusService');
    expect(component).not.toContain('watchActiveStatusesForRegion, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
    expect(component).not.toContain('watchActiveStatusesForUserRegion, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);

    expect(facade).toContain('UserIntentStatusService');
    expect(facade).toContain('watchCurrentStatus, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
    expect(facade).toContain('watchActiveStatusesForRegion, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
    expect(facade).toContain('watchActiveStatusesForUserRegion, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
  });

  it('mantém bootstrap do perfil alheio fora do componente', () => {
    const component = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
    );
    const orchestrator = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-bootstrap.orchestrator.ts'
    );

    expect(component).toContain('VisitedProfileBootstrapOrchestrator');
    expect(component).not.toContain('ActivatedRoute');
    expect(component).not.toContain('FirestoreUserQueryService');
    expect(component).not.toContain('getPublicUserById$(');
    expect(component).not.toContain('loadUserProfile(');
    expect(component).not.toContain('getUidFromRoute(');

    expect(orchestrator).toContain('ActivatedRoute');
    expect(orchestrator).toContain('FirestoreUserQueryService');
    expect(orchestrator).toContain('redirectOwnProfile$(');
  });

  it('mantém afinidades fora do perfil alheio', () => {
    const component = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
    );
    const presenter = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-affinity.presenter.ts'
    );

    expect(component).toContain('VisitedProfileAffinityPresenter');
    expect(component).not.toContain('CurrentUserStoreService');
    expect(component).not.toContain('resolvePublicPreferenceLabel');
    expect(component).not.toContain('evaluateDiscoveryCandidatePreference');

    expect(presenter).toContain('CurrentUserStoreService');
    expect(presenter).toContain('resolvePublicPreferenceLabel');
    expect(presenter).toContain('evaluateDiscoveryCandidatePreference');
  });

  it('mantém composição da timeline fora do SocialExplorePageComponent', () => {
    const component = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.ts'
    );
    const facade = source(
      'src/app/explore/facades/social-explore-timeline.facade.ts'
    );

    expect(component).toContain('SocialExploreTimelineFacade');
    expect(component).not.toContain('buildExplorePersonalFeed');
    expect(component).not.toContain('buildExploreSocialFeed(');
    expect(component).not.toContain('buildExploreSocialFeedWindow');
    expect(component).not.toContain('UserIntentStatusService');
    expect(component).not.toContain('CompatibleProfileCandidatesService');
    expect(component).not.toContain('ExplorePersonalMediaService');

    expect(facade).toContain('buildExplorePersonalFeed');
    expect(facade).toContain('buildExploreSocialFeed(');
    expect(facade).toContain('buildExploreSocialFeedWindow');
    expect(facade).toContain('watchActiveStatusesForUserRegion, () => {
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
);
  });

  it('mantém estados genéricos do Social Explore nas primitives canônicas', () => {
    const template = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.html'
    );
    const styles = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.css'
    );

    expect(template).toContain('<app-content-state');
    expect(template).toContain('app-action app-action--ghost');
    expect(template).toContain('feed-empty app-card app-card--flat');

    expect(styles).not.toContain('.feed-empty__copy');
    expect(styles).not.toContain('.feed-pagination button {');
  });

  it('mantém viewer de mídia fora do SocialExplorePageComponent', () => {
    const component = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.ts'
    );
    const facade = source(
      'src/app/explore/facades/social-explore-media-viewer.facade.ts'
    );

    expect(component).toContain('SocialExploreMediaViewerFacade');
    expect(component).not.toContain('PublicMixedMediaViewerLauncherService');
    expect(component).not.toContain('buildPublicMediaIdentity');
    expect(component).not.toContain('openingMediaKey = signal');
    expect(component).not.toContain('failedVideoPosterKeys = signal');
    expect(component).not.toContain('reportVideoViewerError');

    expect(facade).toContain('PublicMixedMediaViewerLauncherService');
    expect(facade).toContain('buildPublicMediaIdentity');
    expect(facade).toContain('openingMediaKey');
    expect(facade).toContain('failedVideoPosterKeys');
  });

  it('mantém distribuição de Comunidades fora do SocialExplorePageComponent', () => {
    const component = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.ts'
    );
    const facade = source(
      'src/app/explore/facades/social-explore-community-distribution.facade.ts'
    );

    expect(component).toContain('SocialExploreCommunityDistributionFacade');
    expect(component).not.toContain('ExploreCommunityDistributionService');
    expect(component).not.toContain('CommunityDistributionTelemetryService');
    expect(component).not.toContain('recordQualifiedExposure(');

    expect(facade).toContain('ExploreCommunityDistributionService');
    expect(facade).toContain('CommunityDistributionTelemetryService');
    expect(facade).toContain('recordQualifiedExposure(');
    expect(facade).toContain('initials(name: string)');
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

  it('mantém grids migrados responsivos por primitive, sem breakpoints locais', () => {
    const templates = [
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
      'src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html',
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html',
      'src/app/preferences/components/preference-summary-card/preference-summary-card.component.html',
      'src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html',
      'src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html',
      'src/app/preferences/components/discovery-upgrade-hints/discovery-upgrade-hints.component.html',
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html',
    ] as const;
    const styles = templates.map((path) => path.replace(/\.html$/u, '.css'));

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids migrados devem usar a primitive responsiva global.'
    ).toEqual([]);

    expect(
      styles.filter((path) => /@media\s*\(max-width:/u.test(source(path))),
      'Grids migrados não devem recriar breakpoints locais.'
    ).toEqual([]);
  });

  it('não permite imports do diálogo global legado nos consumidores migrados', () => {
    const consumers = [
      'src/app/chat-module/chat-rooms/chat-rooms.component.ts',
      'src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.ts',
      'src/app/layout/friend-management/friend-requests/friend-requests.component.spec.ts',
      'src/app/shared/shared.module.ts',
    ] as const;

    const violations = consumers.filter((path) => {
      const value = source(path);
      return (
        value.includes('ConfirmacaoDialogComponent') ||
        value.includes('ConfirmacaoDialogData') ||
        value.includes('components-globais/confirmacao-dialog')
      );
    });

    expect(
      violations,
      'Consumidores devem usar apenas ConfirmationDialogComponent.'
    ).toEqual([]);
  });

  it('mantém grids de formulário migrados na primitive responsiva', () => {
    const templates = [
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html',
      'src/app/preferences/components/intent-state-form/intent-state-form.component.html',
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html',
    ] as const;

    expect(
      templates.filter((path) => !source(path).includes('app-responsive-grid')),
      'Grids de formulário responsivos devem usar app-responsive-grid.'
    ).toEqual([]);

    const visibilityCss = source(
      'src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.css'
    );
    expect(visibilityCss).not.toMatch(/@media\s*\(max-width:/u);
    expect(visibilityCss).not.toContain('grid-template-columns: repeat(2');

    const intentCss = source(
      'src/app/preferences/components/intent-state-form/intent-state-form.component.css'
    );
    expect(intentCss).not.toContain('.context-grid {\n  display: grid;');
    expect(intentCss).not.toContain('.intent-toggles {\n  display: grid;');

    const profileCss = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'
    );
    expect(profileCss).not.toContain('@media (max-width: 900px)');
    expect(profileCss).not.toContain('.checkbox-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.form-grid {\n  display: grid;');
    expect(profileCss).not.toContain('.inline-options {\n  display: grid;');
  });

  it('mantém CSS de Preferências estruturalmente balanceado', () => {
    const preferencesRoot = resolve(ROOT, 'src/app/preferences');
    const styles: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);

        if (entry.isDirectory()) {
          visit(absolute);
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
          styles.push(absolute);
        }
      }
    };

    visit(preferencesRoot);

    const violations = styles
      .filter((file) => {
        const value = readFileSync(file, 'utf8');
        return (
          (value.match(/\{/gu) ?? []).length !==
          (value.match(/\}/gu) ?? []).length
        );
      })
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
      .sort();

    expect(
      violations,
      'CSS de Preferências não deve conter blocos com chaves órfãs.'
    ).toEqual([]);
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
