// scripts/maintenance/backfill-public-profile-discovery-admin.mjs
// -----------------------------------------------------------------------------
// Backfill local com Admin SDK para preencher campos canônicos de discovery em
// public_profiles existentes.
//
// Pré-requisito recomendado:
// gcloud auth application-default login
//
// Uso PowerShell:
// $env:FIREBASE_PROJECT_ID='entretenimento-sexual'
// $env:BACKFILL_DRY_RUN='true'
// $env:BACKFILL_LIMIT='100'
// node scripts/maintenance/backfill-public-profile-discovery-admin.mjs
// -----------------------------------------------------------------------------

import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const dryRun = String(process.env.BACKFILL_DRY_RUN || 'true').toLowerCase() !== 'false';
const limit = Number.parseInt(String(process.env.BACKFILL_LIMIT || '100'), 10);

function normalizeText(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}

function unique(values) {
  return Array.from(new Set(values));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDiscoveryGender(value) {
  const text = normalizeText(value).replace(/_/g, '-');

  if (['homem', 'homens', 'masculino', 'male', 'man', 'men'].includes(text)) {
    return 'man';
  }

  if (['mulher', 'mulheres', 'feminino', 'female', 'woman', 'women'].includes(text)) {
    return 'woman';
  }

  if (
    [
      'casal',
      'casais',
      'couple',
      'couples',
      'dupla',
      'casal-ele-ele',
      'casal-ele-ela',
      'casal-ela-ela',
    ].includes(text)
  ) {
    return 'couple';
  }

  return 'unknown';
}

function normalizeDiscoveryOrientation(value) {
  const text = normalizeText(value);

  if (['heterossexual', 'heterosexual', 'hetero', 'heteros', 'straight'].includes(text)) {
    return 'heterosexual';
  }

  if (['homossexual', 'homosexual', 'homo', 'gay', 'lesbica', 'lesbian'].includes(text)) {
    return 'homosexual';
  }

  if (['bissexual', 'bisexual', 'bi'].includes(text)) {
    return 'bisexual';
  }

  if (['pansexual', 'pan'].includes(text)) {
    return 'pansexual';
  }

  return 'unknown';
}

function gendersFromFreeText(value) {
  const text = normalizeText(value).replace(/_/g, '-');
  const genders = [];

  if (/\bhomem\b/.test(text) || /\bhomens\b/.test(text) || /\bmasculino\b/.test(text)) {
    genders.push('man');
  }

  if (/\bmulher\b/.test(text) || /\bmulheres\b/.test(text) || /\bfeminino\b/.test(text)) {
    genders.push('woman');
  }

  if (
    /\bcasal\b/.test(text) ||
    /\bcasais\b/.test(text) ||
    /\bdupla\b/.test(text) ||
    /\bcasal-ele-ele\b/.test(text) ||
    /\bcasal-ele-ela\b/.test(text) ||
    /\bcasal-ela-ela\b/.test(text)
  ) {
    genders.push('couple');
  }

  return genders;
}

function orientationsFromFreeText(value) {
  const text = normalizeText(value);
  const orientations = [];

  if (/\bhetero\b/.test(text) || /\bheteros\b/.test(text) || /\bheterossexual\b/.test(text)) {
    orientations.push('heterosexual');
  }

  if (/\bhomo\b/.test(text) || /\bhomossexual\b/.test(text) || /\bgay\b/.test(text) || /\blesbica\b/.test(text)) {
    orientations.push('homosexual');
  }

  if (/\bbi\b/.test(text) || /\bbissexual\b/.test(text)) {
    orientations.push('bisexual');
  }

  if (/\bpan\b/.test(text) || /\bpansexual\b/.test(text)) {
    orientations.push('pansexual');
  }

  return orientations;
}

function normalizeGenderList(values) {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryGender(value);
        return direct !== 'unknown' ? [direct] : gendersFromFreeText(value);
      })
      .filter((value) => value !== 'unknown')
  );
}

function normalizeOrientationList(values) {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryOrientation(value);
        return direct !== 'unknown' ? [direct] : orientationsFromFreeText(value);
      })
      .filter((value) => value !== 'unknown')
  );
}

function acceptedTargetGendersByOrientation(selfGender, selfOrientation) {
  if (selfOrientation === 'bisexual' || selfOrientation === 'pansexual') {
    return ['man', 'woman', 'couple'];
  }

  if (selfGender === 'man' && selfOrientation === 'heterosexual') return ['woman'];
  if (selfGender === 'woman' && selfOrientation === 'heterosexual') return ['man'];
  if (selfGender === 'man' && selfOrientation === 'homosexual') return ['man'];
  if (selfGender === 'woman' && selfOrientation === 'homosexual') return ['woman'];
  if (selfGender === 'couple') return ['man', 'woman', 'couple'];

  return [];
}

function normalizeProfileDiscoveryFields(source) {
  const normalizedGender = normalizeDiscoveryGender(source?.gender ?? source?.genero);
  const normalizedOrientation = normalizeDiscoveryOrientation(
    source?.orientation ?? source?.sexualOrientation ?? source?.orientacao ?? source?.orientacaoSexual
  );

  const explicitGenders = normalizeGenderList(source?.interestedInGenders ?? source?.generosDeInteresse);
  const preferenceGenders = normalizeGenderList(source?.preferences ?? source?.preferencias);
  const fallbackGenders = acceptedTargetGendersByOrientation(normalizedGender, normalizedOrientation);

  const explicitOrientations = normalizeOrientationList(
    source?.interestedInOrientations ?? source?.orientacoesDeInteresse
  );
  const preferenceOrientations = normalizeOrientationList(source?.preferences ?? source?.preferencias);

  const interestedInGenders = explicitGenders.length
    ? explicitGenders
    : preferenceGenders.length
      ? preferenceGenders
      : fallbackGenders;

  const interestedInOrientations = explicitOrientations.length
    ? explicitOrientations
    : preferenceOrientations;

  return {
    normalizedGender,
    normalizedOrientation,
    interestedInGenders,
    interestedInOrientations,
    compatibilityReady:
      normalizedGender !== 'unknown' &&
      normalizedOrientation !== 'unknown' &&
      interestedInGenders.length > 0,
  };
}

function initializeAdmin() {
  if (getApps().length) return;

  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

async function main() {
  initializeAdmin();

  const db = getFirestore();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100;
  const usersSnap = await db.collection('users').limit(safeLimit).get();

  let processed = 0;
  let updated = 0;
  let skippedWithoutPublicProfile = 0;

  const batch = db.batch();

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    processed += 1;

    const publicProfileRef = db.collection('public_profiles').doc(uid);
    const publicProfileSnap = await publicProfileRef.get();

    if (!publicProfileSnap.exists) {
      skippedWithoutPublicProfile += 1;
      continue;
    }

    const canonical = normalizeProfileDiscoveryFields(userDoc.data() ?? {});
    updated += 1;

    console.log('[backfill:discovery] item', {
      uid,
      normalizedGender: canonical.normalizedGender,
      normalizedOrientation: canonical.normalizedOrientation,
      compatibilityReady: canonical.compatibilityReady,
    });

    if (!dryRun) {
      batch.set(publicProfileRef, {
        normalizedGender: canonical.normalizedGender,
        normalizedOrientation: canonical.normalizedOrientation,
        interestedInGenders: canonical.interestedInGenders,
        interestedInOrientations: canonical.interestedInOrientations,
        compatibilityReady: canonical.compatibilityReady,
        discoveryNormalizedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  if (!dryRun && updated > 0) {
    await batch.commit();
  }

  console.log('[backfill:discovery] resumo', {
    projectId,
    dryRun,
    limit: safeLimit,
    processed,
    updated,
    skippedWithoutPublicProfile,
  });
}

main().catch((error) => {
  console.error('[backfill:discovery] falhou', {
    code: error?.code,
    message: error?.message,
  });
  process.exitCode = 1;
});
