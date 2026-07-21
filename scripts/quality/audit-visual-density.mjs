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
  'src/app/account/pages/account-home/account-home.component.html',
  'src/app/notifications/notifications-page/notifications-page.component.html',
  'src/app/chat-module/invite-list/invite-list.component.html',
  'src/app/chat-module/chat-rooms/chat-rooms.component.html',
  'src/app/preferences/pages/preferences-home/preferences-home.component.html',
  'src/app/admin-dashboard/admin-dashboard.component.html',
  'src/app/media/photos/latest-public-photos/latest-public-photos.component.html',
  'src/app/media/photos/top-public-photos/top-public-photos.component.html',
  'src/app/media/photos/boosted-public-photos/boosted-public-photos.component.html',
]);

const normalized = (value) => value.split(path.sep).join('/');
const count = (source, expression) => [...source.matchAll(expression)].length;
const compact = (value) => value.replace(/\s+/g, ' ').trim();

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
const strictFailures = [];

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
