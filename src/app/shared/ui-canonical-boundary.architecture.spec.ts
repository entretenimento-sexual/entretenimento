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



function countOccurrences(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function globalComponentHostCounts(value: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const match of value.matchAll(/(^|\n)\s*(app-[a-z0-9-]+)\b[^{]*\{/giu)) {
    const host = (match[2] ?? '').toLowerCase();
    if (!host) continue;
    counts.set(host, (counts.get(host) ?? 0) + 1);
  }

  return counts;
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
  'src/app/media/videos/profile-videos/profile-videos.component.html',
  'src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.html',
  'src/app/subscriptions/checkout/checkout.component.html',
  'src/app/media/photos/profile-photos/profile-photos.component.html',
  'src/app/media/photos/public-profile-photos/public-profile-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
  'src/app/media/videos/profile-videos/profile-videos.component.html',
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

  it('remove ações vazias do fluxo do PageHeader', () => {
    const styles = source(
      'src/app/shared/page-header/page-header.component.css'
    );

    expect(styles).toContain('.app-page-actions:empty');
    expect(styles).toContain('display: none;');
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
      /(^|[\s,{>])\.btn(?=[\s,{.:>#\[])/u.test(source(path))
    );

    expect(
      violations,
      'CSS local não deve redesenhar a ação genérica legada .btn.'
    ).toEqual([]);
  });

  it('mantém Conta sem contexto repetido nos cabeçalhos internos', () => {
    const manage = source(
      'src/app/account/pages/account-manage/account-manage.component.html'
    );
    const subscriptionHistory = source(
      'src/app/account/pages/subscription-history/subscription-history.component.html'
    );
    const privilegeHistory = source(
      'src/app/account/pages/account-privilege-history/account-privilege-history.component.html'
    );
    const styles = source(
      'src/app/account/pages/account-section.css'
    );

    expect(manage).toContain('<h2 id="account-manage-title">Gerenciar conta</h2>');
    expect(manage).not.toContain('Revise os efeitos antes de suspender ou excluir sua conta.');
    expect(subscriptionHistory).not.toContain('subtitle=');
    expect(privilegeHistory).not.toContain('subtitle=');
    expect(styles).not.toContain('.account-section-header > p:last-child');
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

    expect(safety).toContain('<app-page-header title="Central de Segurança"></app-page-header>');
    expect(safety).toContain('safety-center__action-grid app-responsive-grid');
    expect(safety).not.toContain('safety-center__status');
    expect(safety).not.toContain('Controles essenciais ativos');
    expect(safety).not.toContain('Atalhos para resolver problemas comuns');
    expect(safety).not.toContain('Orientações objetivas para reduzir abuso');
    expect(safety).not.toContain('Camadas que devem ser ampliadas');
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
    expect(verificationStyles).not.toMatch(/\.age-verification__primary(?:\s|,|\{)/u);
    expect(verificationStyles).not.toMatch(/\.age-verification__secondary(?:\s|,|\{)/u);
    expect(verificationStyles).not.toMatch(/\.age-verification__steps(?:\s|,|\{)/u);
    expect(verificationStyles).not.toMatch(/\.age-verification__how-grid(?:\s|,|\{)/u);
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

  it('mantém orquestração de Direct Chat fora do shell visual', () => {
    const layout = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.ts'
    );
    const navigation = source(
      'src/app/chat-module/application/direct-chat-navigation.orchestrator.ts'
    );
    const compose = source(
      'src/app/chat-module/application/direct-chat-compose-access.facade.ts'
    );
    const send = source(
      'src/app/chat-module/application/direct-chat-send.orchestrator.ts'
    );
    const selection = source(
      'src/app/chat-module/application/direct-chat-selection-context.facade.ts'
    );

    expect(layout).toContain('DirectChatNavigationOrchestrator');
    expect(layout).toContain('DirectChatComposeAccessFacade');
    expect(layout).toContain('DirectChatSendOrchestrator');
    expect(layout).toContain('DirectChatSelectionContextFacade');
    expect(layout).not.toContain('DirectThreadFacade');
    expect(layout).not.toContain('FriendshipService');
    expect(layout).not.toContain('FirestoreUserQueryService');
    expect(layout).not.toContain('selectedChatIdSignal');
    expect(layout).not.toContain('selectedTypeSignal');

    expect(navigation).toContain('observeResolvedDeepLinks$');
    expect(navigation).toContain('consumeDeepLinkQueryParams');
    expect(compose).toContain('DirectThreadFacade');
    expect(compose).toContain('FriendshipService');
    expect(send).toContain('DirectThreadFacade');
    expect(selection).toContain('DirectChatFacade');
    expect(selection).toContain('syncPeerContext$');
  });

  it('mantém mensageria direta no pipeline canônico de erros', () => {
    const thread = source(
      'src/app/messaging/direct-chat/application/direct-thread.facade.ts'
    );
    const receipts = source(
      'src/app/messaging/direct-chat/services/direct-receipts.service.ts'
    );

    expect(thread).toContain('ApplicationErrorService');
    expect(receipts).toContain('ApplicationErrorService');
    expect(thread).not.toContain('GlobalErrorHandlerService');
    expect(receipts).not.toContain('GlobalErrorHandlerService');
  });

  it('mantém responsabilidades de perfil alheio fora da camada visual', () => {
    const component = source(
      'src/app/layout/other-user-profile-view/other-user-profile-view.component.ts'
    );
    const friendship = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-friendship.facade.ts'
    );
    const interactions = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-interaction.orchestrator.ts'
    );
    const intent = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-intent-context.facade.ts'
    );
    const bootstrap = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-bootstrap.orchestrator.ts'
    );
    const affinity = source(
      'src/app/layout/other-user-profile-view/application/visited-profile-affinity.presenter.ts'
    );

    expect(component).toContain('VisitedProfileFriendshipFacade');
    expect(component).toContain('VisitedProfileInteractionOrchestrator');
    expect(component).toContain('VisitedProfileIntentContextFacade');
    expect(component).toContain('VisitedProfileBootstrapOrchestrator');
    expect(component).toContain('VisitedProfileAffinityPresenter');
    expect(component).not.toContain('FriendshipService');
    expect(component).not.toContain('DirectChatService');
    expect(component).not.toContain('UserIntentStatusService');
    expect(component).not.toContain('ActivatedRoute');
    expect(component).not.toContain('FirestoreUserQueryService');
    expect(component).not.toContain('CurrentUserStoreService');

    expect(friendship).toContain('FriendshipService');
    expect(interactions).toContain('DirectChatService');
    expect(intent).toContain('UserIntentStatusService');
    expect(bootstrap).toContain('FirestoreUserQueryService');
    expect(affinity).toContain('CurrentUserStoreService');
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
  });

  it('mantém composição do Social Explore fora da página', () => {
    const component = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.ts'
    );
    const timeline = source(
      'src/app/explore/facades/social-explore-timeline.facade.ts'
    );
    const viewer = source(
      'src/app/explore/facades/social-explore-media-viewer.facade.ts'
    );
    const communities = source(
      'src/app/explore/facades/social-explore-community-distribution.facade.ts'
    );

    expect(component).toContain('SocialExploreTimelineFacade');
    expect(component).toContain('SocialExploreMediaViewerFacade');
    expect(component).toContain('SocialExploreCommunityDistributionFacade');
    expect(component).not.toContain('buildExplorePersonalFeed');
    expect(component).not.toContain('UserIntentStatusService');
    expect(component).not.toContain('PublicMixedMediaViewerLauncherService');
    expect(component).not.toContain('ExploreCommunityDistributionService');

    expect(timeline).toContain('buildExplorePersonalFeed');
    expect(timeline).toContain('buildExploreSocialFeed(');
    expect(viewer).toContain('PublicMixedMediaViewerLauncherService');
    expect(communities).toContain('ExploreCommunityDistributionService');
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
    expect(styles).not.toContain('.feed-empty__copy');
  });

  it('mantém contexto operacional fora do perfil próprio', () => {
    const component = source(
      'src/app/user-profile/user-profile-view/user-profile-view.component.ts'
    );
    const facade = source(
      'src/app/user-profile/user-profile-view/application/own-profile-context.facade.ts'
    );

    expect(component).toContain('OwnProfileContextFacade');
    expect(component).not.toContain('ActivatedRoute');
    expect(component).not.toContain('NetworkStatusService');
    expect(component).not.toContain('selectCurrentUser');
    expect(component).not.toContain('ApplicationErrorService');

    expect(facade).toContain('ActivatedRoute');
    expect(facade).toContain('NetworkStatusService');
    expect(facade).toContain('selectCurrentUser');
    expect(facade).toContain('observeUserChanges');
  });

  it('mantém perfil próprio enxuto e sem css legado de redes', () => {
    const template = source(
      'src/app/user-profile/user-profile-view/user-profile-view.component.html'
    );
    const styles = source(
      'src/app/user-profile/user-profile-view/user-profile-view.component.css'
    );

    expect(template).toContain('<app-social-links-accordion');
    expect(template).toContain('<app-content-state');
    expect(template).toContain('app-action app-action--ghost');
    expect(template).toContain('app-card');
    expect(styles).not.toContain('.links-list');
    expect(styles).not.toContain('.links-item');
    expect(styles).not.toContain('.profile-lead');
  });

  it('mantém Online Users com facades de localização, feed e acesso', () => {
    const component = source(
      'src/app/dashboard/online/online-users/online-users.component.ts'
    );
    const location = source(
      'src/app/dashboard/online/online-users/application/online-users-location.facade.ts'
    );
    const feed = source(
      'src/app/dashboard/online/online-users/application/online-users-feed.facade.ts'
    );
    const access = source(
      'src/app/dashboard/online/online-users/application/online-users-access.facade.ts'
    );

    expect(component).toContain('OnlineUsersLocationFacade');
    expect(component).toContain('OnlineUsersFeedFacade');
    expect(component).toContain('OnlineUsersAccessFacade');
    expect(component).not.toContain('GeolocationTrackingService');
    expect(component).not.toContain('DiscoveryCardEnrichmentService');
    expect(component).not.toContain('AccessControlService');

    expect(location).toContain('GeolocationTrackingService');
    expect(feed).toContain('DiscoveryCardEnrichmentService');
    expect(feed).toContain('interval(UI_REFRESH_MS)');
    expect(access).toContain('AccessControlService');
  });

  it('mantém Online Users nas primitives canônicas', () => {
    const component = source(
      'src/app/dashboard/online/online-users/online-users.component.ts'
    );
    const template = source(
      'src/app/dashboard/online/online-users/online-users.component.html'
    );
    const styles = source(
      'src/app/dashboard/online/online-users/online-users.component.css'
    );

    expect(component).toContain('ContentStateComponent');
    expect(template).toContain('<app-content-state');
    expect(styles).not.toContain('.online-users__loader');
    expect(styles).not.toContain('@keyframes online-users-spin');
  });

  it('mantém editor de perfil em facades e primitives canônicas', () => {
    const component = source(
      'src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts'
    );
    const template = source(
      'src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.html'
    );

    expect(template).toContain('app-action');
    expect(template).toContain('app-control');
    expect(component).not.toContain('GlobalErrorHandlerService');
  });

  it('mantém showcase e gerenciador de mídia nas autoridades canônicas', () => {
    const showcase = source(
      'src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component.ts'
    );
    const viewerFacade = source(
      'src/app/media/shared/components/profile-media-showcase/profile-media-showcase-viewer.facade.ts'
    );
    const manager = source(
      'src/app/user-profile/user-photo-manager/user-photo-manager.component.ts'
    );

    expect(showcase).toContain('ProfileMediaShowcaseViewerFacade');
    expect(showcase).not.toContain('PublicMixedMediaViewerLauncherService');
    expect(viewerFacade).toContain('PublicMixedMediaViewerLauncherService');
    expect(manager).not.toContain('deleteDoc(');
  });

  it('mantém links sociais no catálogo e editor canônicos', () => {
    const accordion = source(
      'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts'
    );
    const catalog = source(
      'src/app/core/catalogs/profile-social-links.catalog.ts'
    );

    expect(accordion).toContain('UserSocialLinksService');
    expect(catalog).toContain('PROFILE_SOCIAL_LINK_FIELDS');
  });

  it('mantém navegação gestual compartilhada entre viewers públicos', () => {
    const photo = source(
      'src/app/media/photos/photo-viewer/photo-viewer.component.ts'
    );
    const video = source(
      'src/app/media/videos/public-video-viewer/public-video-viewer.component.ts'
    );
    const policy = source(
      'src/app/media/shared/policies/public-media-viewer-navigation.policy.ts'
    );

    expect(photo).toContain('public-media-viewer-navigation.policy');
    expect(video).toContain('public-media-viewer-navigation.policy');

    expect(photo).not.toContain('PHOTO_SWIPE_MIN_DISTANCE_PX');
    expect(photo).not.toContain('PHOTO_SWIPE_INTENT_DISTANCE_PX');
    expect(video).not.toContain('SWIPE_MIN_DISTANCE_PX');
    expect(video).not.toContain('SWIPE_INTENT_DISTANCE_PX');

    expect(policy).toContain('PUBLIC_MEDIA_VIEWER_SWIPE_MIN_DISTANCE_PX');
    expect(policy).toContain('resolvePublicMediaViewerSwipeDirection');
    expect(policy).toContain('canUsePublicMediaViewerKeyboardNavigation');
  });


  it('mantém estilos de UserCard, Discovery e reply preview fora do global', () => {
    const globalStyles = source('src/styles.css');
    const cardStyles = source(
      'src/app/shared/user-card/user-card.component.css'
    );
    const discoveryStyles = source(
      'src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component.css'
    );
    const chatStyles = source(
      'src/app/chat-module/chat-module-layout/chat-module-layout.component.css'
    );

    expect(globalStyles).not.toContain('app-user-card .user-card');
    expect(globalStyles).not.toContain('app-public-profiles-list');
    expect(globalStyles).not.toContain('.chat-shell__reply-preview');
    expect(globalStyles).not.toContain('app-login-component');
    expect(globalStyles).not.toContain('app-register');

    expect(cardStyles).toContain('--user-card-media-height-mobile');
    expect(discoveryStyles).toContain('--user-card-media-height-mobile');
    expect(chatStyles).toContain('.chat-shell__reply-preview');
  });


  it('mantém densidade de autenticação no componente proprietário', () => {
    const globalStyles = source('src/styles.css');
    const loginStyles = source(
      'src/app/authentication/login-component/login-component.css'
    );
    const registerStyles = source(
      'src/app/register-module/register.component.css'
    );

    expect(globalStyles).not.toContain('Auth form density');
    expect(globalStyles).not.toContain('Auth visual parity');
    expect(loginStyles).toContain('Auth density canônica — ownership local');
    expect(registerStyles).toContain('Auth density canônica — ownership local');
  });


  it('mantém Login e Registro sem classes de formulário legadas', () => {
    const login = source(
      'src/app/authentication/login-component/login-component.html'
    );
    const register = source(
      'src/app/register-module/register.component.html'
    );
    const loginStyles = source(
      'src/app/authentication/login-component/login-component.css'
    );
    const registerStyles = source(
      'src/app/register-module/register.component.css'
    );

    for (const template of [login, register]) {
      expect(template).not.toMatch(/class=["'][^"']*\binput-field\b/u);
      expect(template).not.toMatch(/class=["'][^"']*\bform-field\b/u);
    }

    expect(login).not.toMatch(/class=["'][^"']*\bbtn-link\b/u);
    expect(loginStyles).not.toContain('.input-field');
    expect(registerStyles).not.toContain('.input-field');
    expect(registerStyles).not.toContain('.form-field');
  });


  it('mantém AccountLifecycleDialog nos primitives canônicos', () => {
    const template = source(
      'src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.html'
    );
    const styles = source(
      'src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.css'
    );

    expect(template).not.toMatch(/class=["'][^"']*\bbtn(?:\s|["'])/u);
    expect(template).not.toMatch(/class=["'][^"']*\binput-field\b/u);
    expect(template).toContain('app-action app-action--ghost');
    expect(template).toContain('class="app-control account-lifecycle-dialog__textarea"');
    expect(template).toContain('class="app-control account-lifecycle-dialog__password"');
    expect(styles).not.toContain('.account-lifecycle-dialog__actions .btn');
  });


  it('mantém recuperação de senha nos primitives canônicos', () => {
    const template = source(
      'src/app/authentication/email-input-modal/email-input-modal.component.html'
    );
    const styles = source(
      'src/app/authentication/email-input-modal/email-input-modal.component.css'
    );

    expect(template).not.toMatch(/class=["'][^"']*\binput-field\b/u);
    expect(template).not.toContain('btn-submit');
    expect(template).not.toContain('btn-cancel');
    expect(template).toContain('class="app-control"');
    expect(template).toContain('app-action app-action--primary');
    expect(template).toContain('app-action app-action--ghost');
    expect(styles).not.toContain('.input-field');
    expect(styles).not.toContain('.btn-submit');
    expect(styles).not.toContain('.btn-cancel');
  });


  it('mantém edição de perfil e finalização de cadastro nos primitives canônicos', () => {
    const editProfile = source(
      'src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.html'
    );
    const editProfileStyles = source(
      'src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.css'
    );
    const finishRegistration = source(
      'src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.html'
    );
    const finishRegistrationStyles = source(
      'src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.css'
    );

    for (const template of [editProfile, finishRegistration]) {
      expect(template).not.toMatch(/class=["'][^"']*\binput-field\b/u);
      expect(template).not.toMatch(/class=["'][^"']*\bform-field\b/u);
    }

    expect(finishRegistration).not.toContain('btn-submit');
    expect(editProfileStyles).not.toContain('.form-field');
    expect(finishRegistrationStyles).not.toContain('.input-field');
    expect(finishRegistrationStyles).not.toContain('.form-field');
    expect(finishRegistrationStyles).not.toContain('.btn-submit');
    expect(finishRegistration).toContain(
      'app-action app-action--primary completion-submit'
    );
  });


  it('mantém Welcome e AuthVerificationHandler fora dos botões e campos legados', () => {
    const welcome = source(
      'src/app/register-module/welcome/welcome.component.html'
    );
    const welcomeStyles = source(
      'src/app/register-module/welcome/welcome.component.css'
    );
    const verification = source(
      'src/app/register-module/auth-verification-handler/auth-verification-handler.component.html'
    );
    const verificationStyles = source(
      'src/app/register-module/auth-verification-handler/auth-verification-handler.component.css'
    );

    for (const template of [welcome, verification]) {
      expect(template).not.toMatch(/class=["'][^"']*\bbtn(?:\s|["'])/u);
      expect(template).not.toMatch(/class=["'][^"']*\binput-field\b/u);
    }

    expect(verification).not.toContain('class="form-header"');
    expect(welcomeStyles).not.toContain('.btn-primary');
    expect(welcomeStyles).not.toContain('.actions .btn');
    expect(verificationStyles).not.toContain('.input-field');
    expect(verificationStyles).not.toContain('.cta-row .btn');
    expect(verificationStyles).not.toContain('Modal legado');
    expect(verificationStyles).not.toContain('.modal-overlay');
  });


  it('mantém UserIntentStatusComposer nos actions canônicos', () => {
    const template = source(
      'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component.html'
    );

    expect(template).not.toMatch(/class=["'][^"']*\bbtn(?:\s|["'])/u);
    expect(template).not.toContain('btn-primary');
    expect(template).not.toContain('btn-ghost');
    expect(template).toContain('app-action app-action--primary intent-composer__toggle');
    expect(template).toContain('app-action app-action--ghost intent-composer__cancel');
  });


  it('mantém shared banners e mensagem direta nos actions canônicos', () => {
    const gateBanner = source(
      'src/app/shared/components-globais/email-verification-gate-banner/email-verification-gate-banner.component.html'
    );
    const directMessage = source(
      'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.html'
    );

    for (const template of [gateBanner, directMessage]) {
      expect(template).not.toMatch(/class=["'][^"']*\bbtn(?:\s|["'])/u);
      expect(template).not.toContain('btn-primary');
      expect(template).not.toContain('btn-secondary');
      expect(template).not.toContain('btn-ghost');
    }

    expect(gateBanner).toContain('app-action app-action--primary');
    expect(directMessage).toContain(
      'app-action app-action--primary direct-message-action'
    );
  });


  it('mantém CommunityPreview fora dos botões globais legados', () => {
    const template = source(
      'src/app/community/preview/community-preview-page.component.html'
    );

    expect(template).not.toMatch(/class=["'][^"']*\bbtn(?:\s|["'])/u);
    expect(template).not.toContain('btn-secondary');
    expect(template).toContain('class="app-action" type="button" (click)="retryPreview()"');
  });


  it('mantém formulários de Preferences sem form-field legado', () => {
    const templates = [
      source('src/app/preferences/components/discovery-visibility-form/discovery-visibility-form.component.html'),
      source('src/app/preferences/components/intent-state-form/intent-state-form.component.html'),
      source('src/app/preferences/components/preference-profile-form/preference-profile-form.component.html'),
    ];
    const styles = [
      source('src/app/preferences/components/intent-state-form/intent-state-form.component.css'),
      source('src/app/preferences/components/preference-profile-form/preference-profile-form.component.css'),
    ];

    for (const template of templates) {
      expect(template).not.toMatch(/class=["'][^"']*\bform-field\b/u);
      expect(template).not.toContain('form-field--wide');
    }

    for (const stylesheet of styles) {
      expect(stylesheet).not.toContain('.form-field--wide');
    }
  });


  it('mantém Nearby, BillingReturn e PhotoEditor fora de .btn legado', () => {
    const templates = [
      source('src/app/layout/perfis-proximos/perfis-proximos.component.html'),
      source('src/app/payments-core/pages/billing-return/billing-return.component.html'),
      source('src/app/photo-editor/photo-editor/photo-editor.component.html'),
    ];
    const styles = [
      source('src/app/payments-core/pages/billing-return/billing-return.component.css'),
      source('src/app/photo-editor/photo-editor/photo-editor.component.css'),
    ];

    for (const template of templates) {
      expect(hasClassToken(template, 'btn')).toBe(false);
      expect(template).not.toContain('btn-primary');
      expect(template).not.toContain('btn-secondary');
      expect(template).not.toContain('btn-danger');
      expect(template).not.toContain('btn-ghost');
    }

    for (const stylesheet of styles) {
      expect(stylesheet).not.toMatch(/\.btn(?:\b|-)/u);
    }
  });


  it('proíbe classes visuais legadas em todos os templates de produção', () => {
    const htmlRoot = resolve(ROOT, 'src/app');
    const forbidden = [
      'btn',
      'btn-primary',
      'btn-secondary',
      'btn-danger',
      'btn-success',
      'btn-ghost',
      'btn-link',
      'input-field',
      'form-field',
      'form-wrapper',
      'form-header',
    ] as const;

    for (const file of productionHtmlFiles(htmlRoot)) {
      const template = readFileSync(file, 'utf8');

      for (const token of forbidden) {
        expect(
          hasClassToken(template, token),
          `${relative(ROOT, file)} não deve reutilizar .${token}`
        ).toBe(false);
      }
    }
  });

  it('remove os contratos globais legados de ação e formulário', () => {
    const components = source('src/styles/global-components.css');
    const forms = source('src/styles/global-forms.css');

    expect(components).not.toMatch(/(^|\n)\.btn(?:\b|-)/u);
    expect(components).not.toContain('html.high-contrast .btn');

    expect(forms).not.toMatch(/(^|\n)\.input-field\b/u);
    expect(forms).not.toMatch(/(^|\n)\.form-field\b/u);
    expect(forms).not.toMatch(/(^|\n)\.form-wrapper\b/u);
    expect(forms).not.toMatch(/(^|\n)\.form-header\b/u);

    expect(components).toContain('.alert');
    expect(forms).toContain('.app-control');
    expect(forms).toContain('.app-field');
  });


  it('impede crescimento de !important nos styles globais', () => {
    const budgets = new Map<string, number>([
      ['src/styles.css', 12],
      ['src/styles/global-components.css', 7],
      ['src/styles/global-forms.css', 3],
      ['src/styles/cards.css', 5],
      ['src/styles/global-layout.css', 4],
      ['src/styles/angular-material-bridge.css', 75],
      ['src/styles/visual-clean.css', 10],
      ['src/styles/variables.css', 0],
    ]);

    for (const [path, budget] of budgets) {
      const stylesheet = source(path);
      const current = countOccurrences(stylesheet, /!important/gu);

      expect(
        current,
        `${path} aumentou !important: ${current} > ${budget}`
      ).toBeLessThanOrEqual(budget);
    }
  });

  it('congela overrides globais específicos de componentes', () => {
    const globalStyles = [
      'src/styles.css',
      'src/styles/global-components.css',
      'src/styles/global-forms.css',
      'src/styles/cards.css',
      'src/styles/global-layout.css',
      'src/styles/angular-material-bridge.css',
      'src/styles/variables.css',
    ];

    for (const path of globalStyles) {
      expect(
        [...globalComponentHostCounts(source(path)).entries()],
        `${path} não deve conhecer hosts Angular específicos`
      ).toEqual([]);
    }

    const visualClean = globalComponentHostCounts(
      source('src/styles/visual-clean.css')
    );
    const allowed = new Map<string, number>([
      ['app-community-feed', 20],
      ['app-community-feed-comments', 25],
    ]);

    expect(
      [...visualClean.keys()].sort(),
      'visual-clean.css ganhou novo host Angular global'
    ).toEqual([...allowed.keys()].sort());

    for (const [host, maxSelectors] of allowed) {
      expect(
        visualClean.get(host) ?? 0,
        `visual-clean.css expandiu overrides de ${host}`
      ).toBeLessThanOrEqual(maxSelectors);
    }
  });



  it('mantém subpáginas de Preferences sem navegação segmentada redundante', () => {
    const templates = [
      source('src/app/preferences/pages/compatibility-lab/compatibility-lab.component.html'),
      source('src/app/preferences/pages/discovery-settings/discovery-settings.component.html'),
      source('src/app/preferences/pages/match-profile-lab/match-profile-lab.component.html'),
      source('src/app/preferences/pages/notification-settings/notification-settings.component.html'),
    ];

    for (const template of templates) {
      expect(template).not.toContain('<app-preferences-domain-nav');
    }

    expect(
      existsSync(resolve(ROOT, 'src/app/preferences/components/preferences-domain-nav/preferences-domain-nav.component.ts'))
    ).toBe(false);
  });

  it('mantém descoberta com capabilities no ponto de uso, sem painéis duplicados', () => {
    const page = source(
      'src/app/preferences/pages/discovery-settings/discovery-settings.component.html'
    );
    const panel = source(
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.html'
    );
    const panelSource = source(
      'src/app/preferences/components/discovery-visibility-panel/discovery-visibility-panel.component.ts'
    );

    expect(page).not.toContain('app-discovery-upgrade-hints');
    expect(panel).not.toContain('Liberado');
    expect(panel).not.toContain('Bloqueado');
    expect(panel).not.toContain('panel-grid');
    expect(panelSource).not.toContain('availabilityItems');
    expect(panelSource).not.toContain('monetizationHint');
  });

  it('mantém upgrade avançado contextual e sem copy promocional do plano atual', () => {
    const form = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.html'
    );
    const formSource = source(
      'src/app/preferences/components/preference-profile-form/preference-profile-form.component.ts'
    );

    expect(form).toContain('Práticas e características procuradas ficam disponíveis a partir do Básico.');
    expect(form).toContain('>Ver opções<');
    expect(form).not.toContain('Seu plano {{ currentPlanLabel() }}');
    expect(form).not.toContain('Ver plano Básico');
    expect(formSource).not.toContain('currentPlanLabel = computed');
  });

  it('mantém o editor de Preferences sem promoção permanente de plano', () => {
    const editor = source(
      'src/app/preferences/pages/preferences-editor/preferences-editor.component.html'
    );
    const editorStyles = source(
      'src/app/preferences/pages/preferences-editor/preferences-editor.component.css'
    );
    const editorSource = source(
      'src/app/preferences/pages/preferences-editor/preferences-editor.component.ts'
    );

    expect(editor).not.toContain('plan-strip');
    expect(editor).not.toContain('Plano {{ state.capabilities.currentPlanLabel }}');
    expect(editor).not.toContain('Ver planos');
    expect(editorStyles).not.toContain('.plan-strip');
    expect(editorSource).not.toContain('nextPlan(');
  });

  it('mantém o Preferences Hub orientado a tarefas em vez de painel administrativo', () => {
    const hub = source(
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html'
    );
    const hubStyles = source(
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.css'
    );
    const card = source(
      'src/app/preferences/components/preferences-hub-card/preferences-hub-card.component.html'
    );

    expect(hub).not.toContain('Recursos do plano');
    expect(hub).not.toContain('hub-capability');
    expect(hub).not.toContain('badge="Principal"');
    expect(hub).not.toContain('badge="Teste"');
    expect(hub).not.toContain('badge="Recente"');
    expect(hub).not.toContain('route="/preferencias/match-profile"');
    expect(hub).not.toContain('/preferencias/compatibility-lab/');
    expect(hub).not.toContain('Retomar última comparação');
    expect(hubStyles).not.toContain('.hub-capability');

    expect(card).toContain('[routerLink]="route()"');
    expect(card).not.toContain('>Abrir<');
    expect(card).not.toContain('hub-card-footer');
    expect(card).not.toContain('hub-card__title-row');
    expect(card).not.toContain('hub-card-badge');
  });

  it('mantém densidade semântica enxuta em onboarding e Preferences', () => {
    const welcome = source(
      'src/app/register-module/welcome/welcome.component.html'
    );
    const completion = source(
      'src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.html'
    );
    const hub = source(
      'src/app/preferences/pages/preferences-hub/preferences-hub.component.html'
    );
    expect(welcome).not.toContain('card-kicker');
    expect(completion).not.toContain('completion-hero');
    expect(hub).not.toContain('hub-capabilities');
    expect(hub).not.toContain('<app-preferences-domain-nav');
    expect(hub).not.toContain('id="hub-main-title"');
    expect(hub).not.toContain('id="hub-compatibility-title"');
    expect(hub).not.toContain('Ajustes principais');
    expect(hub).not.toContain('Voltar ao perfil');
    expect(hub).toContain('<app-page-header title="Preferências"></app-page-header>');
    expect(hub).toContain('description="O que você procura e quem quer conhecer."');
    expect(hub).toContain('description="Como seu perfil aparece para outras pessoas."');
    expect(hub).toContain('description="Quais avisos você quer receber."');
    expect(hub).not.toContain('<app-preference-summary-card');
    expect(
      source(
        'src/app/preferences/components/preference-summary-card/preference-summary-card.component.ts'
      )
    ).not.toContain('@Component');
  });


  it('mantém o hero do perfil próprio sem título visual redundante de identidade', () => {
    const template = source(
      'src/app/user-profile/user-profile-view/user-profile-view.component.html'
    );

    expect(template).toContain('<h2 class="visually-hidden">Identidade</h2>');
    expect(template).not.toContain('<h2 class="block-title">Identidade</h2>');
    expect(template).toContain('<h2 class="block-title">Sobre mim</h2>');
  });


  it('mantém Welcome sem duplicar estado de verificação em um segundo cabeçalho', () => {
    const template = source(
      'src/app/register-module/welcome/welcome.component.html'
    );
    const styles = source(
      'src/app/register-module/welcome/welcome.component.css'
    );

    expect(template).toContain(
      "{{ emailVerified ? 'E-mail confirmado' : 'Confirme seu e-mail' }}"
    );
    expect(template).not.toContain('status-card__header');
    expect(template).not.toContain('status-orb');
    expect(template).not.toContain('class="badge');
    expect(styles).not.toContain('.status-card__header');
    expect(styles).not.toContain('.status-orb');
    expect(styles).not.toContain('.badge');
  });


  it('mantém resumos frequentes sem títulos e CTAs redundantes', () => {
    const accountHome = source(
      'src/app/account/pages/account-home/account-home.component.html'
    );
    const accountStyles = source(
      'src/app/account/pages/account-section.css'
    );

    expect(accountHome).not.toContain('account-overview-card__action');
    expect(accountHome).not.toContain('>Ver perfil<');
    expect(accountHome).not.toContain('>Gerenciar assinatura<');
    expect(accountHome).not.toContain('>Revisar segurança<');
    expect(accountStyles).not.toContain('.account-overview-card__action');
  });


  it('mantém o viewer social de vídeo sem segunda autoridade de interações', () => {
    const socialStyles = source(
      'src/app/media/videos/public-video-viewer/public-video-viewer-social.component.css'
    );

    expect(socialStyles).not.toContain('.public-video-viewer__footer-main');
    expect(socialStyles).not.toContain('.public-video-viewer__copy');
    expect(socialStyles).not.toContain(
      '.public-video-viewer .public-video-viewer__footer'
    );
    expect(socialStyles).not.toContain('.public-video-viewer__interactions');
    expect(socialStyles).not.toContain('.public-video-viewer__interaction {');
    expect(socialStyles).not.toContain(
      '.public-video-viewer__interaction--active'
    );
  });

  it('mantém viewers e cards públicos de Media sem microcopy e métricas duplicadas', () => {
    const photoViewer = source(
      'src/app/media/photos/photo-viewer/photo-viewer.component.html'
    );
    const photoViewerStyles = source(
      'src/app/media/photos/photo-viewer/photo-viewer.component.css'
    );
    const videoViewer = source(
      'src/app/media/videos/public-video-viewer/public-video-viewer.component.html'
    );
    const videoViewerStyles = source(
      'src/app/media/videos/public-video-viewer/public-video-viewer.component.css'
    );
    const photoCard = source(
      'src/app/media/shared/components/public-photo-card/public-photo-card.component.html'
    );
    const videoCard = source(
      'src/app/media/shared/components/public-video-card/public-video-card.component.html'
    );

    expect(photoViewer).not.toContain('viewer-owner-cta');
    expect(videoViewer).not.toContain('public-video-viewer__owner-cta');
    expect(photoViewerStyles).not.toContain('.viewer-owner-cta');
    expect(videoViewerStyles).not.toContain('.public-video-viewer__owner-cta');

    expect(photoCard).not.toContain("@case ('latest')");
    expect(videoCard).not.toContain('public-video-card__views-metric');
  });

  it('mantém galerias públicas de Media sem chrome e estilos residuais', () => {
    const publicPhotos = source(
      'src/app/media/photos/public-profile-photos/public-profile-photos.component.html'
    );
    const publicPhotoStyles = source(
      'src/app/media/photos/public-profile-photos/public-profile-photos.component.css'
    );
    const publicVideos = source(
      'src/app/media/videos/public-profile-videos/public-profile-videos.component.html'
    );
    const publicVideoStyles = source(
      'src/app/media/videos/public-profile-videos/public-profile-videos.component.css'
    );
    const topPhotoStyles = source(
      'src/app/media/photos/top-public-photos/top-public-photos.component.css'
    );

    expect(publicPhotos).toContain(
      '<app-page-header title="Fotos públicas"></app-page-header>'
    );
    expect(publicPhotos).not.toContain('Voltar ao perfil');
    expect(publicPhotos).not.toContain('gallery-strip');
    expect(publicPhotos).not.toContain('Conteúdo aprovado');
    expect(publicPhotoStyles).not.toContain('.back-link');
    expect(publicPhotoStyles).not.toContain('.gallery-pill');
    expect(publicPhotoStyles).not.toContain('.gallery-strip');

    expect(publicVideos).toContain('<app-page-header title="Vídeos">');
    expect(publicVideos).not.toContain('<h1 id="public-profile-videos-title">');
    expect(publicVideos).not.toContain('Voltar ao perfil');
    expect(publicVideoStyles).not.toContain('.back-link');
    expect(publicVideoStyles).not.toContain('.public-videos-header');
    expect(publicVideoStyles).not.toContain('.title-block');

    expect(topPhotoStyles).not.toContain('.eyebrow');
    expect(topPhotoStyles).not.toContain('.subtitle');
    expect(topPhotoStyles).not.toContain('.title-block h2');
    expect(topPhotoStyles).not.toContain('.empty-state');
  });

  it('mantém Vídeos no PageHeader canônico e sem descrição redundante no editor', () => {
    const videos = source(
      'src/app/media/videos/profile-videos/profile-videos.component.html'
    );
    const styles = source(
      'src/app/media/videos/profile-videos/profile-videos.component.css'
    );
    const settingsStyles = source(
      'src/app/media/videos/profile-videos/profile-videos-settings.component.css'
    );

    expect(videos).toContain('<app-page-header title="Meus vídeos">');
    expect(videos).not.toContain('<h1>Meus vídeos</h1>');
    expect(videos).not.toContain('video-settings-description');
    expect(videos).not.toContain(
      'Ajuste as informações e as interações de'
    );
    expect(styles).not.toContain('.profile-videos__header');
    expect(settingsStyles).not.toContain('.profile-videos__header');
    expect(settingsStyles).not.toContain(
      '.profile-videos__settings-dialog-heading p'
    );
  });

  it('mantém cabeçalhos de Fotos sem instruções e retorno redundantes', () => {
    const upload = source(
      'src/app/media/photos/photo-upload/photo-upload.component.html'
    );
    const profilePhotos = source(
      'src/app/media/photos/profile-photos/profile-photos.component.html'
    );

    expect(upload).toContain('<app-page-header title="Adicionar foto">');
    expect(upload).not.toContain('Escolha, ajuste e confirme antes de enviar.');
    expect(profilePhotos).toContain('<app-page-header title="Fotos do perfil">');
    expect(profilePhotos).not.toContain(
      'Revise as fotos adicionadas, publique quando estiverem prontas'
    );
    expect(profilePhotos).not.toContain('Voltar ao perfil');
  });

  it('mantém Checkout e Comunidades sem contexto repetido', () => {
    const checkout = source(
      'src/app/subscriptions/checkout/checkout.component.html'
    );
    const community = source(
      'src/app/community/discovery/community-discovery-page.component.html'
    );
    const communitySource = source(
      'src/app/community/discovery/community-discovery-page.component.ts'
    );

    expect(checkout).not.toContain('<strong>Plano:</strong> {{ plan.title }}');
    expect(community).toContain('Novidades importantes aparecem primeiro.');
    expect(community).not.toContain(
      'Silenciar alertas reduz notificações push'
    );
    expect(communitySource).not.toContain(
      "'Comunidades das quais você participa ou administra.'"
    );
  });

  it('mantém Planos de assinatura sem contexto e atalhos redundantes', () => {
    const template = source(
      'src/app/subscriptions/subscription-plan/subscription-plan.component.html'
    );
    const styles = source(
      'src/app/subscriptions/subscription-plan/subscription-plan.component.css'
    );

    expect(template).toContain('<app-page-header title="Planos de assinatura">');
    expect(template).not.toContain('Ative os benefícios da sua conta');
    expect(template).not.toContain('Atalhos rápidos');
    expect(template).not.toContain('subscription-plan-status-card__eyebrow');
    expect(styles).not.toContain('.subscription-plan-status-card__eyebrow');
    expect(template).not.toContain('subscription-plan-context__eyebrow');
    expect(styles).not.toContain('.subscription-plan-context__eyebrow');
  });


  it('mantém Explore e Notificações sem overlines e explicações redundantes', () => {
    const explore = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.html'
    );
    const exploreStyles = source(
      'src/app/explore/pages/social-explore-page/social-explore-page.component.css'
    );
    const notifications = source(
      'src/app/notifications/notifications-page/notifications-page.component.html'
    );
    const notificationStyles = source(
      'src/app/notifications/notifications-page/notifications-page.component.css'
    );

    expect(explore).not.toContain('<span>Descobrir</span>');
    expect(explore).not.toContain('<span>Suas Comunidades</span>');
    expect(exploreStyles).not.toContain('.video-highlights__header > div');
    expect(exploreStyles).not.toContain('.community-distribution__header > div');

    expect(notifications).not.toContain(
      'As Comunidades abaixo refletem atividade recente'
    );
    expect(notifications).not.toContain(
      'Há atividade de Comunidades fora das notificações recentes'
    );
    expect(notifications).not.toContain('notificação não lida');
    expect(notifications).not.toContain(
      'Abrir a lista não altera o estado de leitura das atividades.'
    );
    expect(notificationStyles).not.toContain('.community-activity__header p');
    expect(notificationStyles).not.toContain('.community-activity__fallback p');
    expect(notifications).not.toContain(
      '@if (notificationRoute(item) || item.readAt === null)'
    );
    expect(notifications).not.toContain(
      '(click)="openNotification(item)"\n                    [disabled]="isBusy(item.id)"'
    );
    expect(notifications).toContain('notification-card__title-action');
    expect(notifications).toContain('community-activity__title-action');
    expect(notifications).not.toContain('community-activity__open app-action');
    expect(notifications).not.toContain('>Em dia<');

    const settings = source(
      'src/app/preferences/pages/notification-settings/notification-settings.component.html'
    );

    expect(settings).not.toContain('identificador aleatório desta instalação');
    expect(settings).toContain('Sem impressão digital do dispositivo.');
  });


  it('mantém superfícies operacionais sem overlines redundantes', () => {
    const photoEditor = source(
      'src/app/photo-editor/photo-editor/photo-editor.component.html'
    );
    const photoEditorStyles = source(
      'src/app/photo-editor/photo-editor/photo-editor.component.css'
    );
    const operational = source(
      'src/app/admin-dashboard/operational-overview/operational-overview.component.html'
    );
    const operationalStyles = source(
      'src/app/admin-dashboard/operational-overview/operational-overview.component.css'
    );
    const videoModeration = source(
      'src/app/admin-dashboard/video-moderation/video-moderation.component.html'
    );
    const videoModerationStyles = source(
      'src/app/admin-dashboard/video-moderation/video-moderation.component.css'
    );

    expect(photoEditor).not.toContain('class="eyebrow"');
    expect(photoEditor).toContain('editor-selection-panel__eyebrow');
    expect(photoEditorStyles).not.toMatch(/(^|\n)\.eyebrow\b/u);

    expect(operational).not.toContain('operational-hero__eyebrow');
    expect(operational).not.toContain('operational-panel__eyebrow');
    expect(operational).not.toContain('mobile-summary__eyebrow');
    expect(operationalStyles).not.toContain('__eyebrow');

    expect(videoModeration).not.toContain('video-moderation__eyebrow');
    expect(videoModerationStyles).not.toContain('video-moderation__eyebrow');
  });


  it('preserva conteúdo legal e operacional sem linhas introdutórias redundantes', () => {
    const terms = source(
      'src/app/register-module/terms-acceptance/terms-acceptance-page.component.html'
    );
    const termsStyles = source(
      'src/app/register-module/terms-acceptance/terms-acceptance-page.component.css'
    );
    const billing = source(
      'src/app/payments-core/pages/billing-return/billing-return.component.html'
    );
    const billingStyles = source(
      'src/app/payments-core/pages/billing-return/billing-return.component.css'
    );
    const lifecycle = source(
      'src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.html'
    );
    const lifecycleStyles = source(
      'src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.css'
    );

    expect(terms).not.toContain('terms-acceptance__kicker');
    expect(terms).toContain('Versão {{ legalManifest.termsAcceptanceVersion }}');
    expect(termsStyles).not.toContain('terms-acceptance__kicker');

    expect(billing).not.toContain('billing-return-card__eyebrow');
    expect(billing).toContain('billing-return-card__description');
    expect(billingStyles).not.toContain('billing-return-card__eyebrow');

    expect(lifecycle).not.toContain('account-lifecycle-dialog__eyebrow');
    expect(lifecycle).toContain('account-lifecycle-dialog__description');
    expect(lifecycleStyles).not.toContain('account-lifecycle-dialog__eyebrow');
  });


  it('mantém Comunidades oficiais sem contexto duplicado', () => {
    const officialTarget = source(
      'src/app/community/official-communities-for-target/official-communities-for-target.component.html'
    );
    const officialTargetStyles = source(
      'src/app/community/official-communities-for-target/official-communities-for-target.component.css'
    );
    const profileOfficial = source(
      'src/app/community/profile-official-communities/profile-official-communities.component.html'
    );
    const profileOfficialStyles = source(
      'src/app/community/profile-official-communities/profile-official-communities.component.css'
    );

    expect(officialTarget).not.toContain('official-communities__eyebrow');
    expect(officialTargetStyles).not.toContain('official-communities__eyebrow');
    expect(officialTarget).toContain('official-communities__context');
    expect(officialTarget).toContain('app-community-official-badge');

    expect(profileOfficial).not.toContain('profile-official-communities__eyebrow');
    expect(profileOfficialStyles).not.toContain('profile-official-communities__eyebrow');
    expect(profileOfficial).toContain('profile-official-communities__context');
  });


  it('mantém painéis administrativos sem overlines redundantes', () => {
    const moderation = source(
      'src/app/admin-dashboard/moderation-reports/moderation-reports.component.html'
    );
    const moderationStyles = source(
      'src/app/admin-dashboard/moderation-reports/moderation-reports.component.css'
    );
    const deletion = source(
      'src/app/admin-dashboard/account-deletion-operations/account-deletion-operations.component.html'
    );
    const deletionStyles = source(
      'src/app/admin-dashboard/account-deletion-operations/account-deletion-operations.component.css'
    );
    const claims = source(
      'src/app/admin-dashboard/community-official-claims/community-official-claims.component.html'
    );
    const claimsStyles = source(
      'src/app/admin-dashboard/community-official-claims/community-official-claims.component.css'
    );
    const users = source(
      'src/app/admin-dashboard/user-list/user-list.component.html'
    );
    const userStyles = source(
      'src/app/admin-dashboard/user-list/user-list.component.css'
    );

    expect(moderation).not.toContain('moderation-reports__eyebrow');
    expect(moderationStyles).not.toContain('moderation-reports__eyebrow');
    expect(deletion).not.toContain('deletion-operations__eyebrow');
    expect(deletionStyles).not.toContain('deletion-operations__eyebrow');
    expect(claims).not.toContain('official-claims__kicker');
    expect(claimsStyles).not.toContain('official-claims__kicker');
    expect(users).not.toContain('user-review-header__eyebrow');
    expect(userStyles).not.toContain('user-review-header__eyebrow');
  });


  it('mantém recuperação de senha e ownership sem rótulos introdutórios redundantes', () => {
    const recovery = source(
      'src/app/authentication/email-input-modal/email-input-modal.component.html'
    );
    const recoveryStyles = source(
      'src/app/authentication/email-input-modal/email-input-modal.component.css'
    );
    const ownership = source(
      'src/app/community/ownership-management/community-ownership-management.component.html'
    );
    const ownershipStyles = source(
      'src/app/community/ownership-management/community-ownership-management.component.css'
    );

    expect(recovery).not.toContain('modal-kicker');
    expect(recovery).toContain('modal-description');
    expect(recoveryStyles).not.toContain('.modal-kicker');

    expect(ownership).not.toContain('community-ownership-management__eyebrow');
    expect(ownership).toContain('community-ownership-management__intro');
    expect(ownershipStyles).not.toContain('community-ownership-management__eyebrow');
  });


  it('mantém diálogos e recuperação sem rótulos contextuais redundantes', () => {
    const directMessage = source(
      'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.html'
    );
    const directMessageStyles = source(
      'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component.css'
    );
    const reportDialog = source(
      'src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.html'
    );
    const reportDialogStyles = source(
      'src/app/shared/components-globais/moderation-report/report-content-dialog/report-content-dialog.component.css'
    );
    const recovery = source(
      'src/app/register-module/account-recovery/account-recovery-page.component.html'
    );
    const recoveryStyles = source(
      'src/app/register-module/account-recovery/account-recovery-page.component.css'
    );

    expect(directMessage).not.toContain('direct-message-eyebrow');
    expect(directMessageStyles).not.toContain('direct-message-eyebrow');

    expect(reportDialog).not.toContain('report-dialog__eyebrow');
    expect(reportDialogStyles).not.toContain('report-dialog__eyebrow');

    expect(recovery).not.toContain('class="eyebrow"');
    expect(recoveryStyles).not.toMatch(/(^|\n)\.eyebrow\b/u);
  });


  it('mantém documentos legais sem overlines classificatórios redundantes', () => {
    const cookies = source(
      'src/app/footer/legal-footer/politica-de-cookies/politica-de-cookies.component.html'
    );
    const cookiesStyles = source(
      'src/app/footer/legal-footer/politica-de-cookies/politica-de-cookies.component.css'
    );
    const privacy = source(
      'src/app/footer/legal-footer/politica-de-privacidade/politica-de-privacidade.component.html'
    );
    const privacyStyles = source(
      'src/app/footer/legal-footer/politica-de-privacidade/politica-de-privacidade.component.css'
    );
    const terms = source(
      'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.html'
    );
    const termsStyles = source(
      'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.css'
    );

    expect(cookies).not.toContain('cookie-document__eyebrow');
    expect(cookiesStyles).not.toContain('cookie-document__eyebrow');
    expect(privacy).not.toContain('privacy-document__eyebrow');
    expect(privacyStyles).not.toContain('privacy-document__eyebrow');
    expect(terms).not.toContain('legal-document__eyebrow');
    expect(termsStyles).not.toContain('legal-document__eyebrow');
  });


  it('mantém discovery e previews sem contexto introdutório redundante', () => {
    const suggested = source(
      'src/app/dashboard/suggested-profiles/suggested-profiles.component.html'
    );
    const suggestedStyles = source(
      'src/app/dashboard/suggested-profiles/suggested-profiles.component.css'
    );
    const matchPreview = source(
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.html'
    );
    const matchPreviewStyles = source(
      'src/app/preferences/components/match-profile-preview-card/match-profile-preview-card.component.css'
    );
    const publicPhotos = source(
      'src/app/media/photos/public-profile-photos/public-profile-photos.component.html'
    );

    expect(suggested).not.toContain('suggested-profiles-hero__eyebrow');
    expect(suggestedStyles).not.toContain('suggested-profiles-hero__eyebrow');

    expect(matchPreview).not.toContain('card-subtitle');
    expect(matchPreviewStyles).not.toContain('.card-subtitle');

    expect(publicPhotos).not.toContain('subtitle="Explore as fotos aprovadas deste perfil."');
  });

});
