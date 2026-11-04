#!/usr/bin/env node
// Issue #236: non-mutating inventory of private legacy discovery fields.
// Reads only the local Firestore Emulator. NEVER prints values or document IDs.
// No write mode, migrations, uploads, credential providers or network API calls
// outside the local Emulator Hub and Firestore Emulator.

import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  assertLocalAuditOnly,
  describePrivateFields,
  privateSourceDescriptors,
  makeEmptyAudit,
  addAuditResult,
  PRIVATE_DISCOVERY_INTEREST_FIELDS,
  EMULATOR_HOST,
  PROJECT_ID,
  MAX_PROFILE_DOCS,
} from './discovery-legacy-preferences-audit.policy.mjs';

async function assertLocalHub() {
  const response = await fetch('http://127.0.0.1:4400/emulators', {
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Emulator Hub nao respondeu com sucesso.');

  const running = await response.json();
  if (running?.firestore?.host !== '127.0.0.1' ||
      running?.firestore?.port !== 8080) {
    throw new Error('Firestore Emulator local nao confirmado pelo Hub.');
  }
}

async function assertCheckpointMetadataPresent() {
  const filename = path.resolve(
    process.cwd(), '.emulator-data', 'firebase-export-metadata.json'
  );
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error('Metadados do checkpoint local invalidos.');
  }
  // Presence is a prerequisite, not proof that restoration succeeds.
}

async function main() {
  // Preflight MUST complete before importing/initializing Admin SDK.
  assertLocalAuditOnly(process.env, process.argv.slice(2));
  await assertLocalHub();
  await assertCheckpointMetadataPresent();

  // Delayed import ensures rejected invocations cannot initialize Firebase.
  const [{ initializeApp, deleteApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);

  const app = initializeApp({ projectId: PROJECT_ID }, 'legacy-preferences-readonly-audit');
  try {
    const db = getFirestore(app);
    const profiles = await db.collection('public_profiles')
      .limit(MAX_PROFILE_DOCS + 1).get();

    if (profiles.size > MAX_PROFILE_DOCS) {
      throw new Error('Limite de documentos excedido; auditoria incompleta.');
    }

    const report = makeEmptyAudit();
    report.scanned = profiles.size;
    report.checkpointMetadataPresent = true;

    for (const publicDoc of profiles.docs) {
      const descriptors = describePrivateFields(publicDoc.data());
      if (!descriptors.length) continue;

      const paths = privateSourceDescriptors(publicDoc.id);
      const snapshots = await db.getAll(...paths.map(({ path: docPath }) => db.doc(docPath)));
      const sources = snapshots.map((snapshot, index) => ({
        label: paths[index].label,
        exists: snapshot.exists,
        fields: snapshot.exists
          ? PRIVATE_DISCOVERY_INTEREST_FIELDS.filter(
            (field) => Object.hasOwn(snapshot.data() ?? {}, field)
          )
          : [],
      }));

      addAuditResult(report, descriptors, sources);
    }

    // Only aggregated field names, counts and presence flags are emitted.
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await deleteApp(app);
  }
}

main().catch((error) => {
  // Sanitized failure; do not print Firestore paths, IDs, field values or stack.
  const isExpected = error instanceof Error && (
    /^(FIRESTORE_EMULATOR_HOST|FIREBASE_PROJECT_ID|GCLOUD_PROJECT|GCP_PROJECT|Argumento nao autorizado|Emulator Hub|Firestore Emulator local|Metadados do checkpoint|Limite de documentos)/.test(error.message)
  );
  console.error(
    isExpected
      ? `[audit:discovery] ${error.message}`
      : '[audit:discovery] Falha tecnica na auditoria local. Nenhum dado foi alterado.'
  );
  process.exitCode = 2;
});
