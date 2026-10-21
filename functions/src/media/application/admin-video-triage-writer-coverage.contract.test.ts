/**
 * c18w source-only classification of direct job writes, not global proof.
 * Adding or changing a writer site requires explicit review before CI passes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import ts from 'typescript';

const root = resolve(__dirname, '../../../src');
type Site = 'STATE' | 'VERSION' | 'CREATE' | 'DELETE' |
  'DYNAMIC' | 'METADATA' | 'PROJECTION';
interface Writer {
  path: string;
  sites: readonly Site[];
  events: number;
  creations: number;
}

const WRITERS: readonly Writer[] = [
  {
    path: 'media/application/queue-video-processing.handler.ts',
    sites: ['STATE', 'STATE', 'CREATE'], events: 2, creations: 1,
  },
  {
    path: 'media/application/video-processing.handler.ts',
    sites: ['STATE', 'STATE', 'STATE', 'STATE', 'STATE', 'STATE',
      'STATE', 'METADATA'], events: 7, creations: 0,
  },
  {
    path: 'media/application/video-processing-reconciliation.firestore.ts',
    sites: ['METADATA', 'METADATA', 'METADATA', 'METADATA',
      'DELETE', 'METADATA', 'METADATA', 'STATE', 'DYNAMIC', 'METADATA'],
    events: 3, creations: 0,
  },
  {
    path: 'media/application/video-processing-terminal-commit.firestore.ts',
    sites: ['STATE', 'STATE', 'STATE'], events: 3, creations: 0,
  },
  {
    path: 'media/application/admin-video-processing-recovery.handler.ts',
    sites: ['VERSION', 'DYNAMIC'], events: 2, creations: 0,
  },
  {
    path: 'media/application/video-source-probe.service.ts',
    sites: ['STATE', 'METADATA', 'STATE', 'METADATA', 'STATE'],
    events: 3, creations: 0,
  },
  {
    path: 'media/application/video-immutable-input-preflight.service.ts',
    sites: ['STATE', 'METADATA', 'STATE', 'METADATA', 'STATE'],
    events: 3, creations: 0,
  },
  {
    path: 'media/application/emulator-video-processing.service.ts',
    sites: ['STATE', 'STATE'], events: 2, creations: 0,
  },
  {
    path: 'media/application/video-profile-deletion-commit.firestore.ts',
    sites: ['STATE'], events: 1, creations: 0,
  },
  {
    path: 'media/application/admin-video-triage-backfill.firestore.ts',
    sites: ['PROJECTION'], events: 0, creations: 0,
  },
  {
    path: 'account_lifecycle/account-owned-media-deletion.firestore.ts',
    sites: ['DELETE', 'DYNAMIC', 'DYNAMIC', 'DELETE'], events: 4, creations: 0,
  },
] as const;

const JOB_REFS: ReadonlySet<string> = new Set([
  'jobRef', 'processingRef', 'processingJobRef', 'jobSnapshot.ref', 'current.ref',
]);

interface Observed {
  method: string;
  ref: string;
  patch: string;
  transaction: string | null;
}

function transactionBody(node: ts.Node): string | null {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
        parent.parameters.some(parameter =>
          parameter.name.getText() === 'transaction')) {
      return parent.body.getText();
    }
    parent = parent.parent;
  }
  return null;
}

function scan(source: string, path: string): {
  sites: Observed[]; events: number; creations: number;
} {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const sites: Observed[] = [];
  let events = 0;
  let creations = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'stageVideoTriageMutationInTransaction') {
        events++;
      } else if (node.expression.text === 'stageVideoTriageCreatedJobInTransaction') {
        creations++;
      }
    }
    if (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText() === 'transaction' &&
        ['set', 'update', 'create', 'delete'].includes(node.expression.name.text) &&
        node.arguments.length > 0 &&
        JOB_REFS.has(node.arguments[0].getText())) {
      sites.push({
        method: node.expression.name.text,
        ref: node.arguments[0].getText(),
        patch: node.arguments[1]?.getText() ?? '',
        transaction: transactionBody(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { sites, events, creations };
}

function kind(site: Observed): Site {
  if (site.method === 'delete') return 'DELETE';
  if (site.method === 'create') return 'CREATE';
  if (site.patch.includes('...retryJob')) return 'VERSION';
  if (site.patch.includes('update.jobPatch') ||
      /,\s*(?:jobPatch|patch)\s*,/.test(site.patch)) return 'DYNAMIC';
  if (site.ref === 'current.ref') return 'PROJECTION';
  if (/(?:^|[^A-Za-z0-9_])state\s*:/.test(site.patch)) return 'STATE';
  return 'METADATA';
}

function verify(entry: Writer, source: string): void {
  const observed = scan(source, entry.path);
  assert.deepEqual(observed.sites.map(kind), entry.sites,
    entry.path + ': review new or reclassified job writer sites');
  assert.equal(observed.events, entry.events,
    entry.path + ': mutation staging count changed');
  assert.equal(observed.creations, entry.creations,
    entry.path + ': creation staging count changed');

  for (const [i, site] of observed.sites.entries()) {
    assert.ok(site.transaction, entry.path + ': direct writer lacks transaction');
    if (entry.sites[i] === 'METADATA' || entry.sites[i] === 'PROJECTION') {
      assert.ok(!/\bstate\s*:/.test(site.patch),
        entry.path + ': state mutation cannot be metadata');
    } else {
      const helper = entry.sites[i] === 'CREATE'
        ? 'stageVideoTriageCreatedJobInTransaction('
        : 'stageVideoTriageMutationInTransaction(';
      assert.ok(site.transaction?.includes(helper),
        entry.path + ': mutation must stage event in the same transaction');
    }
  }
}

test('c18w audited job writer sites and event counts are fail closed', () => {
  for (const writer of WRITERS) {
    const source = readFileSync(resolve(root, writer.path), 'utf8');
    verify(writer, source);
    if (writer.path.startsWith('account_lifecycle/')) {
      // Both indirect patches must still explicitly request cancellation.
      assert.equal((source.match(/state: 'CANCEL_REQUESTED' as const/g) ?? []).length, 2);
    }
  }
  assert.equal(WRITERS.reduce((sum, x) => sum + x.sites.length, 0), 44);
  assert.equal(WRITERS.reduce((sum, x) => sum + x.events + x.creations, 0), 31);
});

test('c18w mutation fixtures reject new writers and orphan transitions', () => {
  const writer: Writer = {
    path: 'fixture.ts', sites: ['STATE'], events: 1, creations: 0,
  };
  const sample = [
    'async function apply() {',
    '  await firestore.runTransaction(async transaction => {',
    '    const before = await transaction.get(jobRef);',
    '    stageVideoTriageMutationInTransaction(firestore, transaction, jobRef, {',
    '      eventId, before, kind: "STATE_TRANSITION", afterState: "FAILED"',
    '    });',
    '    transaction.update(jobRef, { state: "FAILED" });',
    '  });',
    '}',
  ].join('\n');
  verify(writer, sample);
  assert.throws(() => verify(writer, sample.replace(
    '    transaction.update(jobRef, { state: "FAILED" });',
    '    transaction.update(jobRef, { state: "FAILED" });\n' +
    '    transaction.update(jobRef, { state: "SUCCEEDED" });'
  )), /reclassified job writer sites/);
  assert.throws(() => verify(writer,
    sample.replace('stageVideoTriageMutationInTransaction(', 'notStaged(')),
  /mutation staging count changed/);
  assert.throws(() => verify({ ...writer, sites: ['METADATA'] }, sample),
    /reclassified job writer sites/);
});

test('c18w audit never promotes partial writer coverage to global readiness', () => {
  const outbox = readFileSync(resolve(root,
    'media/application/admin-video-triage-mutation-outbox.firestore.ts'), 'utf8');
  const readiness = readFileSync(resolve(root,
    'media/application/admin-video-triage-readiness.policy.ts'), 'utf8');
  const admin = readFileSync(resolve(root,
    'media/application/admin-video-processing-recovery.handler.ts'), 'utf8');
  const recovered = readFileSync(resolve(root,
    'media/application/video-processing-reconciliation.firestore.ts'), 'utf8');
  assert.ok(outbox.includes("scope: 'PARTIAL_WRITER_COVERAGE'"));
  assert.ok(outbox.includes('globalCoverageVerified: false'));
  assert.ok(outbox.includes('globallySequenced: false'));
  assert.ok(readiness.includes('activationAuthorized: false'));
  assert.ok(admin.includes('if (nextState !== state)'));
  assert.ok(recovered.includes(
    "typeof nextState === 'string' && nextState !== current?.state"));
  assert.ok(!outbox.includes('globalCoverageVerified: true'));
});
