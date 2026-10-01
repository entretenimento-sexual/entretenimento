import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { glob } from 'glob';

const projectRoot = process.cwd();
const strict = process.argv.includes('--strict');

const criticalTemplates = new Set([
  'src/app/header/navbar/navbar.component.html',
  'src/app/dashboard/principal/principal.component.html',
  'src/app/explore/pages/social-explore-page/social-explore-page.component.html',
  'src/app/community/discovery/community-discovery-page.component.html',
  'src/app/community/preview/community-preview-page.component.html',
  'src/app/community/membership-management/community-membership-management.component.html',
  'src/app/community/member-roster-management/community-member-roster-management.component.html',
  'src/app/account/pages/account-home/account-home.component.html',
  'src/app/notifications/notifications-page/notifications-page.component.html',
  'src/app/chat-module/chat-rooms/chat-rooms.component.html',
  'src/app/preferences/pages/preferences-hub/preferences-hub.component.html',
  'src/app/preferences/pages/preferences-editor/preferences-editor.component.html',
  'src/app/admin-dashboard/admin-dashboard.component.html',
  'src/app/layout/perfis-proximos/perfis-proximos.component.html',
  'src/app/dashboard/online/online-users/online-users.component.html',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
  'src/app/subscriptions/subscription-plan/subscription-plan.component.html',
  'src/app/register-module/welcome/welcome.component.html',
]);

const normalized = (value) => value.split(path.sep).join('/');
const count = (source, expression) => [...source.matchAll(expression)].length;
const compact = (value) => value.replace(/\s+/g, ' ').trim();

const semanticIntroKinds = [
  ['eyebrow', /(?:^|[-_])eyebrow(?:$|[-_])/i],
  ['overline', /(?:^|[-_])overline(?:$|[-_])/i],
  ['kicker', /(?:^|[-_])kicker(?:$|[-_])/i],
  ['subtitle', /(?:^|[-_])subtitle(?:$|[-_])/i],
  ['description', /(?:^|[-_])description(?:$|[-_])/i],
  ['lede', /(?:^|[-_])lede(?:$|[-_])/i],
  ['lead', /(?:^|[-_])lead(?:$|[-_])/i],
  ['intro', /(?:^|[-_])intro(?:$|[-_])/i],
];

const reviewedSemanticContent = new Map([
  ['src/app/subscriptions/subscription-plan/subscription-plan.component.html', new Set([
    'subscription-plan-status-card__description',
    'plan-description',
  ])],
  ['src/app/chat-module/chat-rooms/chat-rooms.component.html', new Set([
    'chat-rooms__description',
  ])],
  ['src/app/community/membership-management/community-membership-management.component.html', new Set([
    'community-management-hub__eyebrow',
  ])],
  ['src/app/register-module/welcome/welcome.component.html', new Set([
    'subtitle',
  ])],
  ['src/app/account/pages/account-privilege-history/account-privilege-history.component.html', new Set([
    'subscription-history-event__description',
    'app-page-header[subtitle]',
  ])],
  ['src/app/account/pages/compliance-cases/compliance-cases.component.html', new Set([
    'compliance-detail__eyebrow',
    'app-page-header[subtitle]',
  ])],
  ['src/app/account/pages/subscription-history/subscription-history.component.html', new Set([
    'subscription-history-event__description',
    'app-page-header[subtitle]',
  ])],
  ['src/app/community/official-communities-for-target/official-communities-for-target.component.html', new Set([
    'official-community__description',
  ])],
  ['src/app/media/photos/profile-photos/profile-photos.component.html', new Set([
    'subtitle',
    'app-page-header[subtitle]',
  ])],
  ['src/app/photo-editor/photo-editor/photo-editor.component.html', new Set([
    'subtitle',
    'editor-selection-panel__eyebrow',
  ])],
  ['src/app/preferences/components/compatibility-preview-card/compatibility-preview-card.component.html', new Set([
    'compatibility-subtitle',
    'reason-description',
  ])],
  ['src/app/preferences/components/preferences-hub-card/preferences-hub-card.component.html', new Set([
    'hub-card-description',
    'app-card__subtitle',
  ])],
  ['src/app/register-module/terms-acceptance/terms-acceptance-page.component.html', new Set([
    'terms-acceptance__lead',
  ])],
  ['src/app/shared/components-globais/universal-sidebar/universal-sidebar.component.html', new Set([
    'universal-sidebar__profile-subtitle',
  ])],
  ['src/app/account/components/account-lifecycle-dialog/account-lifecycle-dialog.component.html', new Set([
    'account-lifecycle-dialog__description',
  ])],
  ['src/app/account/pages/account-status/account-status.component.html', new Set([
    'app-page-header[subtitle]',
  ])],
  ['src/app/account/pages/legal-documents/legal-documents.component.html', new Set([
    'app-page-header[subtitle]',
  ])],
  ['src/app/admin-dashboard/user-details/compliance-notice-dialog.component.html', new Set([
    'compliance-dialog__lead',
  ])],
  ['src/app/authentication/email-input-modal/email-input-modal.component.html', new Set([
    'modal-description',
  ])],
  ['src/app/authentication/login-component/login-component.html', new Set([
    'auth-intro',
  ])],
  ['src/app/community/ownership-management/community-ownership-management.component.html', new Set([
    'community-ownership-management__intro',
  ])],
  ['src/app/community/profile-official-communities/profile-official-communities.component.html', new Set([
    'profile-official-community__description',
  ])],
  ['src/app/compliance/adult-consent-page/adult-consent-page.component.html', new Set([
    'app-page-header[subtitle]',
  ])],
  ['src/app/compliance/age-reverification-page/age-reverification-page.component.html', new Set([
    'app-page-header[subtitle]',
  ])],
  ['src/app/compliance/age-verification-page/age-verification-page.component.html', new Set([
    'app-page-header[subtitle]',
  ])],
]);

const isReviewedSemanticContent = (relativePath, token) =>
  reviewedSemanticContent.get(relativePath)?.has(token) === true;

const semanticIntroClasses = (source) => {
  const findings = [];

  for (const match of source.matchAll(/class\s*=\s*["']([^"']*)["']/gi)) {
    const tokens = (match[1] ?? '').split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      for (const [kind, expression] of semanticIntroKinds) {
        if (expression.test(token)) {
          findings.push({ kind, token });
          break;
        }
      }
    }
  }

  if (/<app-page-header\b[^>]*\bsubtitle\s*=|<app-page-header\b[^>]*\[subtitle\]/i.test(source)) {
    findings.push({ kind: 'subtitle', token: 'app-page-header[subtitle]' });
  }

  return findings;
};

const htmlPaths = await glob('src/app/**/*.html', {
  cwd: projectRoot,
  nodir: true,
  ignore: ['**/node_modules/**'],
});
const cssPaths = await glob(['src/app/**/*.css', 'src/styles/**/*.css', 'src/styles.css'], {
  cwd: projectRoot,
  nodir: true,
  ignore: ['**/node_modules/**'],
});

const templateFindings = [];
const semanticResiduals = [];
const reviewedResiduals = [];
const actionableResiduals = [];
const strictFailures = [];

const htmlPathSet = new Set(htmlPaths.map(normalized));
for (const criticalPath of criticalTemplates) {
  if (!htmlPathSet.has(criticalPath)) {
    strictFailures.push(
      `configuração da auditoria aponta para template crítico inexistente: ${criticalPath}.`
    );
  }
}

for (const relativePath of htmlPaths.map(normalized).sort()) {
  const source = await readFile(path.join(projectRoot, relativePath), 'utf8');
  const h1Count = count(source, /<h1\b/gi);
  const headingCount = count(source, /<h[1-6]\b/gi);
  const paragraphCount = count(source, /<p\b/gi);
  const cardClassCount = count(source, /class\s*=\s*["'][^"']*(?:card|hero|panel)[^"']*["']/gi);
  const hasEyebrow = /(?:eyebrow|overline|kicker)/i.test(source);
  const hasIntroCopy = /(?:subtitle|description|lede|__intro)/i.test(source);
  const hasIntroStack = h1Count > 0 && hasEyebrow && hasIntroCopy;
  const isCritical = criticalTemplates.has(relativePath);
  const semanticClasses = semanticIntroClasses(source);

  if (semanticClasses.length > 0) {
    const byKind = Object.fromEntries(
      semanticIntroKinds.map(([kind]) => [
        kind,
        semanticClasses.filter((item) => item.kind === kind).length,
      ])
    );

    const reviewed = semanticClasses.filter((item) =>
      isReviewedSemanticContent(relativePath, item.token)
    );
    const actionable = semanticClasses.filter((item) =>
      !isReviewedSemanticContent(relativePath, item.token)
    );

    const baseResidual = {
      path: relativePath,
      isCritical,
      total: semanticClasses.length,
      byKind,
      tokens: [...new Set(semanticClasses.map((item) => item.token))],
    };

    semanticResiduals.push(baseResidual);

    if (reviewed.length > 0) {
      reviewedResiduals.push({
        path: relativePath,
        isCritical,
        total: reviewed.length,
        tokens: [...new Set(reviewed.map((item) => item.token))],
      });
    }

    if (actionable.length > 0) {
      actionableResiduals.push({
        path: relativePath,
        isCritical,
        total: actionable.length,
        byKind: Object.fromEntries(
          semanticIntroKinds.map(([kind]) => [
            kind,
            actionable.filter((item) => item.kind === kind).length,
          ])
        ),
        tokens: [...new Set(actionable.map((item) => item.token))],
      });
    }
  }

  if (h1Count > 1 || hasIntroStack || headingCount >= 7 || cardClassCount >= 10) {
    templateFindings.push({
      path: relativePath,
      h1Count,
      headingCount,
      paragraphCount,
      cardClassCount,
      hasIntroStack,
      isCritical,
    });
  }

  if (isCritical && h1Count > 1) {
    strictFailures.push(`${relativePath}: possui ${h1Count} títulos <h1>.`);
  }

  if (isCritical && hasIntroStack) {
    strictFailures.push(
      `${relativePath}: combina eyebrow/overline, título e subtítulo introdutório.`
    );
  }
}

const cssFindings = [];

for (const relativePath of cssPaths.map(normalized).sort()) {
  const source = await readFile(path.join(projectRoot, relativePath), 'utf8');
  const shadowCount = count(source, /box-shadow\s*:/gi);
  const gradientCount = count(source, /(?:linear|radial)-gradient\s*\(/gi);
  const pillCount = count(source, /border-radius\s*:\s*999(?:px|rem)?/gi);
  const importantCount = count(source, /!important/gi);
  const score = shadowCount * 3 + gradientCount * 2 + pillCount + importantCount;

  if (score >= 12) {
    cssFindings.push({
      path: relativePath,
      score,
      shadowCount,
      gradientCount,
      pillCount,
      importantCount,
    });
  }
}

const topTemplates = templateFindings
  .sort((a, b) => {
    const aScore = a.headingCount * 2 + a.cardClassCount + Number(a.hasIntroStack) * 6;
    const bScore = b.headingCount * 2 + b.cardClassCount + Number(b.hasIntroStack) * 6;
    return bScore - aScore || a.path.localeCompare(b.path);
  })
  .slice(0, 15);

const semanticSummary = semanticResiduals.reduce(
  (summary, item) => {
    summary.templates += 1;
    summary.occurrences += item.total;
    if (item.isCritical) {
      summary.criticalTemplates += 1;
      summary.criticalOccurrences += item.total;
    }

    for (const [kind, value] of Object.entries(item.byKind)) {
      summary.byKind[kind] = (summary.byKind[kind] ?? 0) + value;
    }

    return summary;
  },
  {
    templates: 0,
    occurrences: 0,
    criticalTemplates: 0,
    criticalOccurrences: 0,
    byKind: {},
  }
);

const actionableSummary = actionableResiduals.reduce(
  (summary, item) => {
    summary.templates += 1;
    summary.occurrences += item.total;
    if (item.isCritical) {
      summary.criticalTemplates += 1;
      summary.criticalOccurrences += item.total;
    }

    for (const [kind, value] of Object.entries(item.byKind)) {
      summary.byKind[kind] = (summary.byKind[kind] ?? 0) + value;
    }

    return summary;
  },
  {
    templates: 0,
    occurrences: 0,
    criticalTemplates: 0,
    criticalOccurrences: 0,
    byKind: {},
  }
);

const reviewedOccurrenceCount = reviewedResiduals.reduce(
  (total, item) => total + item.total,
  0
);

const topSemanticResiduals = actionableResiduals
  .sort((a, b) => {
    if (a.isCritical !== b.isCritical) return Number(b.isCritical) - Number(a.isCritical);
    return b.total - a.total || a.path.localeCompare(b.path);
  })
  .slice(0, 30);

const topStyles = cssFindings
  .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  .slice(0, 15);

console.log('[audit:visual] Auditoria de densidade visual');
console.log(`[audit:visual] Templates analisados: ${htmlPaths.length}`);
console.log(`[audit:visual] Folhas de estilo analisadas: ${cssPaths.length}`);

if (topTemplates.length > 0) {
  console.log('\n[audit:visual] Templates que merecem revisão:');
  for (const item of topTemplates) {
    console.log(
      `- ${item.path} | h1=${item.h1Count} headings=${item.headingCount} ` +
        `parágrafos=${item.paragraphCount} cards=${item.cardClassCount} ` +
        `intro-tripla=${item.hasIntroStack ? 'sim' : 'não'}`
    );
  }
}

if (semanticSummary.occurrences > 0) {
  const categorySummary = semanticIntroKinds
    .map(([kind]) => `${kind}=${semanticSummary.byKind[kind] ?? 0}`)
    .join(' ');

  console.log(
    '\n[audit:visual] Baseline semântico: ' +
      `templates=${semanticSummary.templates} ` +
      `ocorrências=${semanticSummary.occurrences} ` +
      `templates-críticos=${semanticSummary.criticalTemplates} ` +
      `ocorrências-críticas=${semanticSummary.criticalOccurrences} ` +
      `| ${categorySummary}`
  );
}

if (semanticSummary.occurrences > 0) {
  const actionableCategorySummary = semanticIntroKinds
    .map(([kind]) => `${kind}=${actionableSummary.byKind[kind] ?? 0}`)
    .join(' ');

  console.log(
    '[audit:visual] Classificação semântica: ' +
      `reconhecidas=${reviewedOccurrenceCount} ` +
      `acionáveis=${actionableSummary.occurrences} ` +
      `templates-acionáveis=${actionableSummary.templates} ` +
      `críticas-acionáveis=${actionableSummary.criticalOccurrences} ` +
      `| ${actionableCategorySummary}`
  );
}

if (topSemanticResiduals.length > 0) {
  console.log('\n[audit:visual] Resíduos semânticos acionáveis para revisão:');
  for (const item of topSemanticResiduals) {
    const kinds = Object.entries(item.byKind)
      .filter(([, value]) => value > 0)
      .map(([kind, value]) => `${kind}=${value}`)
      .join(' ');

    console.log(
      `- ${item.path} | crítico=${item.isCritical ? 'sim' : 'não'} ` +
        `total=${item.total} ${kinds} | tokens=${item.tokens.join(', ')}`
    );
  }
}

if (topStyles.length > 0) {
  console.log('\n[audit:visual] CSS com maior carga decorativa:');
  for (const item of topStyles) {
    console.log(
      `- ${item.path} | score=${item.score} sombras=${item.shadowCount} ` +
        `gradientes=${item.gradientCount} pílulas=${item.pillCount} important=${item.importantCount}`
    );
  }
}

if (strictFailures.length > 0) {
  console.error('\n[audit:visual] Falhas nas superfícies críticas:');
  for (const failure of strictFailures) {
    console.error(`- ${compact(failure)}`);
  }

  if (strict) {
    process.exitCode = 1;
  }
} else {
  console.log('\n[audit:visual] Superfícies críticas dentro do contrato clean.');
}

if (!strict) {
  console.log(
    '\n[audit:visual] Modo informativo. Use --strict para bloquear regressões nas superfícies críticas.'
  );
}
