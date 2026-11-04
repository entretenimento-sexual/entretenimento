// Policy-only helpers for a local, read-only legacy preference audit.
// No Firebase initialization, external I/O or mutations are allowed here.
// Keep this list identical to lacksPrivateDiscoveryInterestFields() in
// firestore-rules/public_profiles_next.rules and to PRIVATE_DISCOVERY_INTEREST_FIELDS.
export const PRIVATE_DISCOVERY_INTEREST_FIELDS = Object.freeze([
  'preferences', 'preferencias', 'interests', 'interesses',
  'lookingFor', 'buscando', 'discoveryPreferences', 'hardRules',
  'softRules', 'matchingModes', 'selfTraits',
  'interestedInGenders', 'interestedInGender', 'targetGenders',
  'preferredGenders', 'generosDeInteresse',
  'interestedInOrientations', 'interestedInOrientation',
  'targetOrientations', 'preferredOrientations',
  'orientacoesDeInteresse',
]);

export const EMULATOR_HOST = '127.0.0.1:8080';
export const PROJECT_ID = 'entretenimento-sexual';
export const MAX_PROFILE_DOCS = 200;

export function assertLocalAuditOnly(env, argv = []) {
  if (env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST deve ser 127.0.0.1:8080.');
  }

  for (const name of ['FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT']) {
    if (env[name] && env[name] !== PROJECT_ID) {
      throw new Error(`${name} nao corresponde ao projeto local esperado.`);
    }
  }

  if (argv.some((arg) => arg !== '--dry-run')) {
    throw new Error('Argumento nao autorizado: este programa aceita somente --dry-run.');
  }
}

// Returns shapes and counts, never values or document identifiers.
// A nonempty array is NOT proof that values can be migrated semantically.
export function describePrivateFields(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];

  return PRIVATE_DISCOVERY_INTEREST_FIELDS
    .filter((field) => Object.hasOwn(data, field))
    .map((field) => {
      const value = data[field];
      const isArray = Array.isArray(value);
      return {
        field,
        kind: isArray
          ? 'array'
          : value === null
            ? 'null'
            : typeof value,
        items: isArray ? value.length : 0,
        invalidArrayItems: isArray
          ? value.filter((item) => typeof item !== 'string' || !item.trim()).length
          : 0,
      };
    });
}

export function privateSourceDescriptors(uid) {
  return [
    { label: 'users', path: `users/${uid}` },
    { label: 'preferencesProfile', path: `users/${uid}/preferences/profile` },
    { label: 'preferencesIntent', path: `users/${uid}/preferences/intent` },
    { label: 'publicUserPreferencesLegacy', path: `public_user_preferences/${uid}` },
    { label: 'matchProfileLegacy', path: `match_profiles/${uid}` },
  ];
}

// Aggregates only metadata; uid, values, aliases and raw snapshots are discarded.
export function makeEmptyAudit() {
  return {
    mode: 'READ_ONLY',
    project: PROJECT_ID,
    sampleLimit: MAX_PROFILE_DOCS,
    scanned: 0,
    affected: 0,
    affectedWithNonemptyArrays: 0,
    affectedWithUnexpectedTypes: 0,
    sensitiveFieldPresence: {},
    arrayItemCounts: {},
    invalidArrayItemCounts: {},
    sourceDocumentsFound: Object.fromEntries(
      privateSourceDescriptors('test').map(({ label }) => [label, 0])
    ),
    sourceDocumentsWithSameKey: Object.fromEntries(
      privateSourceDescriptors('test').map(({ label }) => [label, 0])
    ),
    writesPerformed: 0,
    requiresSemanticReview: true,
    requiresOwnerVisibilityDecision: true,
    checkpointMetadataPresent: false,
  };
}

export function addAuditResult(aggregate, descriptors, sources) {
  if (!descriptors.length) return;

  aggregate.affected += 1;
  if (descriptors.some(({ items }) => items > 0)) {
    aggregate.affectedWithNonemptyArrays += 1;
  }
  if (descriptors.some(({ kind, invalidArrayItems }) =>
    kind !== 'array' || invalidArrayItems > 0)) {
    aggregate.affectedWithUnexpectedTypes += 1;
  }

  for (const { field, items, invalidArrayItems } of descriptors) {
    aggregate.sensitiveFieldPresence[field] =
      (aggregate.sensitiveFieldPresence[field] ?? 0) + 1;
    aggregate.arrayItemCounts[field] =
      (aggregate.arrayItemCounts[field] ?? 0) + items;
    aggregate.invalidArrayItemCounts[field] =
      (aggregate.invalidArrayItemCounts[field] ?? 0) + invalidArrayItems;
  }

  for (const source of sources) {
    if (!Object.hasOwn(aggregate.sourceDocumentsFound, source.label)) {
      throw new Error('Origem privada desconhecida.');
    }

    if (source.exists) {
      aggregate.sourceDocumentsFound[source.label] += 1;
    }

    // Same-key presence is only a hint, NOT proof of equivalent private data.
    if (source.exists && descriptors.some(({ field }) =>
      source.fields.includes(field))) {
      aggregate.sourceDocumentsWithSameKey[source.label] += 1;
    }
  }
}
