import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
  console.error('Use apenas --dry-run para simular a limpeza.');
  process.exit(1);
}

function localHost(variable, fallback) {
  const host = process.env[variable] ?? fallback;
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(host);
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535) {
    console.error(`${variable} deve apontar para um emulador local.`);
    process.exit(1);
  }
  return host.replace(/^localhost:/, '127.0.0.1:');
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ??
  process.env.GCP_PROJECT ?? 'entretenimento-sexual';
if (projectId !== 'entretenimento-sexual' && !/^demo-[a-z0-9-]{1,60}$/.test(projectId)) {
  console.error('Use o projeto local entretenimento-sexual ou um projeto de demonstração demo-*.');
  process.exit(1);
}

process.env.FIRESTORE_EMULATOR_HOST = localHost('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
process.env.FIREBASE_AUTH_EMULATOR_HOST = localHost('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
const app = initializeApp({ projectId }, 'registration-draft-cleanup-dry-run');
const db = getFirestore(app);
const asOfMs = Date.now();
const counts = { expiredDrafts: 0, validDrafts: 0, accountReceipts: 0, unclassified: 0 };
const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const auth = getAuth(app);
const DAY_MS = 86_400_000;
const stages = {
  emailPending: { days: 7, active: 0, candidates: 0 },
  passwordPending: { days: 7, active: 0, candidates: 0 },
  termsPending: { days: 30, active: 0, candidates: 0 },
  profilePending: { days: 90, active: 0, candidates: 0 },
};
const accounts = { stages, protected: 0, unclassified: 0 };

function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'string') return Date.parse(value);
  return typeof value === 'number' ? value : NaN;
}

async function classifyAccounts(batch) {
  const { users } = await auth.getUsers(batch.map(doc => ({ uid: doc.id })));
  const usersByUid = new Map(users.map(user => [user.uid, user]));
  for (const doc of batch) {
    const user = usersByUid.get(doc.id);
    const data = doc.data();
    if (data.accountStatus !== 'active' || data.accountLocked === true || data.suspended === true ||
        data.loginAllowed === false || data.registrationCompletedAt != null ||
        data.deletionRequestedAt != null || data.deletedAt != null ||
        data.ageReverificationRestrictedAt != null || data.moderationAutomationHold?.active === true ||
        data.legalHold === true || data.billingHold === true || data.isSubscriber === true || user?.disabled) {
      accounts.protected++;
      continue;
    }
    if (!user || data.uid !== doc.id || data.registrationFlowVersion !== 'v3-private-by-default' ||
        data.publicVisibility !== 'hidden' || data.interactionBlocked !== true || data.loginAllowed !== true) {
      accounts.unclassified++;
      continue;
    }
    const [age, publicProfile] = await db.getAll(
      db.doc(`age_eligibility_records/${doc.id}`), db.doc(`public_profiles/${doc.id}`)
    );
    if (publicProfile.exists || ['REVIEW_REQUIRED', 'DENIED_UNDERAGE'].includes(age.get('status'))) {
      accounts.protected++;
      continue;
    }
    const createdAt = millis(user.metadata.creationTime);
    const lastActivity = Math.max(createdAt, ...[
      user.metadata.lastSignInTime, user.metadata.lastRefreshTime, data.createdAt,
      data.lastLogin, data.acceptedTerms?.acceptedAt, age.get('updatedAtMs'),
    ].map(millis).filter(Number.isFinite));
    if (!Number.isFinite(lastActivity) || lastActivity <= 0 || lastActivity > asOfMs) {
      accounts.unclassified++;
      continue;
    }

    const stage = !user.emailVerified ? stages.emailPending
      : doc.id.startsWith('email-link-preview-') && !user.passwordHash ? stages.passwordPending
      : data.acceptedTerms?.accepted !== true ? stages.termsPending
      : stages.profilePending;
    const field = asOfMs - lastActivity >= stage.days * DAY_MS ? 'candidates' : 'active';
    stage[field]++;
  }
}

async function auditAccounts() {
  const records = db.collection('users').where('profileCompleted', '==', false)
    .select('uid', 'accountStatus', 'accountLocked', 'suspended', 'loginAllowed', 'publicVisibility',
      'interactionBlocked', 'registrationFlowVersion', 'registrationCompletedAt', 'createdAt',
      'lastLogin', 'acceptedTerms.accepted', 'acceptedTerms.acceptedAt', 'deletionRequestedAt', 'deletedAt',
      'ageReverificationRestrictedAt', 'moderationAutomationHold.active', 'legalHold', 'billingHold', 'isSubscriber')
    .stream();

  let batch = [];
  for await (const doc of records) {
    batch.push(doc);
    if (batch.length === 100) {
      await classifyAccounts(batch);
      batch = [];
    }
  }
  if (batch.length) await classifyAccounts(batch);
}

try {
  // A coleção reúne rascunhos de IDs aleatórios e recibos vinculados ao UID.
  // A projeção carrega somente os campos necessários à contagem.
  const records = db.collection('registration_email_link_drafts')
    .select('expiresAtMs', 'adultDeclaredAtMs', 'adultDeclarationVersion')
    .stream();

  for await (const doc of records) {
    const { expiresAtMs, adultDeclaredAtMs, adultDeclarationVersion } = doc.data();
    if (doc.id.startsWith('email-link-preview-') ||
        adultDeclaredAtMs !== undefined || adultDeclarationVersion !== undefined) {
      counts.accountReceipts++;
    } else if (!draftIdPattern.test(doc.id) || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
      counts.unclassified++;
    } else if (expiresAtMs <= asOfMs) {
      counts.expiredDrafts++;
    } else {
      counts.validDrafts++;
    }
  }

  await auditAccounts();

  console.log(JSON.stringify({
    mode: 'dry-run',
    projectId,
    asOf: new Date(asOfMs).toISOString(),
    ...counts,
    accounts,
  }, null, 2));
} catch {
  console.error('Falha na leitura. Confira se Auth e Firestore Emulator estão ativos no projeto indicado.');
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
