// scripts/quality/check-ui-action-redundancy-boundary.mjs
// -----------------------------------------------------------------------------
// GLOBAL UI ACTION REDUNDANCY BOUNDARY
// -----------------------------------------------------------------------------
// Evita repetir no empty state a mesma ação já exposta no app-page-header.
// A identidade é derivada de (click), [routerLink], routerLink ou href.
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { glob } from 'glob';

const root = process.cwd();
const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function findMatchingClose(source, tagName, openEnd) {
  const expression = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
  expression.lastIndex = openEnd;
  let depth = 1;

  for (let match = expression.exec(source); match; match = expression.exec(source)) {
    if (/^<\//.test(match[0])) {
      depth -= 1;
      if (depth === 0) return expression.lastIndex;
    } else if (!/\/>$/.test(match[0])) {
      depth += 1;
    }
  }

  return source.length;
}

function extractBlocks(source, predicate) {
  const blocks = [];
  const openingTag = /<([a-z][\w-]*)\b([^>]*)>/gi;

  for (let match = openingTag.exec(source); match; match = openingTag.exec(source)) {
    const full = match[0];
    const tagName = match[1];
    const attrs = match[2] ?? '';

    if (/\/>$/.test(full) || !predicate(tagName.toLowerCase(), attrs)) {
      continue;
    }

    const end = findMatchingClose(source, tagName, openingTag.lastIndex);
    blocks.push(source.slice(match.index, end));
    openingTag.lastIndex = end;
  }

  return blocks;
}

function escapeRegExp(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function attribute(attrs, name) {
  const escaped = escapeRegExp(name);
  const expression = new RegExp(
    escaped + '\\s*=\\s*(?:"([^"]*)"|\\'([^\\']*)\\')',
    'i'
  );
  const match = attrs.match(expression);
  return compact(match?.[1] ?? match?.[2] ?? '');
}

function actionIdentity(attrs) {
  const click = attribute(attrs, '(click)');
  if (click) return 'click:' + click;

  const boundRouterLink = attribute(attrs, '[routerLink]');
  if (boundRouterLink) return 'routerLink:' + boundRouterLink;

  const routerLink = attribute(attrs, 'routerLink');
  if (routerLink) return 'routerLink:' + routerLink;

  const href = attribute(attrs, 'href');
  if (href && href !== '#' && !href.startsWith('javascript:')) {
    return 'href:' + href;
  }

  return '';
}

function actionLabel(body, attrs) {
  const ariaLabel = attribute(attrs, 'aria-label');
  if (ariaLabel) return ariaLabel;

  return compact(
    body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{[\s\S]*?\}\}/g, ' ')
  );
}

function extractActions(block) {
  const actions = [];
  const expression = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  for (let match = expression.exec(block); match; match = expression.exec(block)) {
    const attrs = match[2] ?? '';
    const identity = actionIdentity(attrs);
    if (!identity) continue;

    actions.push({
      identity,
      label: actionLabel(match[3] ?? '', attrs),
    });
  }

  return actions;
}

const templates = await glob('src/app/**/*.html', {
  cwd: root,
  nodir: true,
  ignore: ['**/node_modules/**'],
});

const findings = [];

for (const relativePath of templates.sort()) {
  const source = await readFile(path.join(root, relativePath), 'utf8');

  const headers = extractBlocks(
    source,
    (tagName) => tagName === 'app-page-header'
  );
  if (headers.length === 0) continue;

  const emptyStates = extractBlocks(
    source,
    (_tagName, attrs) => {
      const classes = attribute(attrs, 'class');
      return /(?:^|\s)(?:app-empty-card|empty-state)(?:\s|$)/.test(classes);
    }
  );
  if (emptyStates.length === 0) continue;

  const headerActions = headers.flatMap(extractActions);
  const emptyActions = emptyStates.flatMap(extractActions);

  for (const headerAction of headerActions) {
    for (const emptyAction of emptyActions) {
      if (emptyAction.identity !== headerAction.identity) continue;

      findings.push({
        path: relativePath.split(path.sep).join('/'),
        identity: headerAction.identity,
        headerLabel: headerAction.label || '(sem rótulo)',
        emptyLabel: emptyAction.label || '(sem rótulo)',
      });
    }
  }
}

if (findings.length > 0) {
  console.error(
    '[ui-action-redundancy] Falha: a mesma ação aparece no cabeçalho e no empty state.'
  );

  for (const finding of findings) {
    console.error(
      '- ' + finding.path +
      ' | ' + finding.identity +
      ' | header="' + finding.headerLabel +
      '" empty="' + finding.emptyLabel + '"'
    );
  }

  console.error(
    '[ui-action-redundancy] Mantenha um único CTA primário; o empty state comunica estado, não replica a ação.'
  );
  process.exit(1);
}

console.log(
  '[ui-action-redundancy] OK: ' +
  templates.length +
  ' templates verificados; nenhum CTA de page header duplicado em empty state.'
);
