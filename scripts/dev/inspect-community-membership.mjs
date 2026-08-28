// scripts/dev/inspect-community-membership.mjs
// -----------------------------------------------------------------------------
// DEBUG DEV/EMULATOR - COMMUNITY MEMBERSHIP
// -----------------------------------------------------------------------------
// Diagnóstico somente leitura para conferir Auth, Firestore e uma membership
// canônica durante testes locais de Comunidades.
//
// - exige Auth Emulator e Firestore Emulator;
// - resolve a conta gestora por COMMUNITY_MANAGER_EMAIL/UID e preserva
//   COMMUNITY_MODERATOR_EMAIL/UID como aliases compatíveis;
// - considera COMMUNITY_MANAGER_ROLE=moderator|admin|owner para validar o ator;
// - aceita COMMUNITY_DEBUG_MEMBER_ID para inspecionar qualquer membro do seed;
// - valida ponteiro ownerUid e unicidade de active/owner no cenário de owner;
// - expõe métricas/lifecycle necessários para depurar retenção sem editar dados;
// - lê a membership canônica e o evento de auditoria mais recente do alvo;
// - não cria, altera ou exclui documentos;
// - não imprime token, senha, e-mail de terceiros ou payload privado completo.
// -----------------------------------------------------------------------------

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const MANAGER_ROLES = new Set(['moderator', 'admin', 'owner']);
const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST ?? '').trim();
const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '').trim();
const communityId = String(
  process.env.COMMUNITY_DEBUG_ID ?? 'community-bdsm-brasil'
).trim();
const email = String(
  process.env.COMMUNITY_MANAGER_EMAIL
  ?? process.env.COMMUNITY_MODERATOR_EMAIL
  ?? ''
).trim().toLowerCase();
const uid = String(
  process.env.COMMUNITY_MANAGER_UID
  ?? process.env.COMMUNITY_MODERATOR_UID
  ?? ''
).trim();
const expectedManagerRole = String(
  process.env.COMMUNITY_MANAGER_ROLE ?? 'moderator'
).trim().toLowerCase();
const explicitMemberId = String(
  process.env.COMMUNITY_DEBUG_MEMBER_ID ?? ''
).trim();

if (!firestoreHost || !authHost) {
  console.error(
    '[inspect:community-membership] Abortado: Auth e Firestore Emulators precisam estar configurados.'
  );
  process.exit(1);
}

if (!MANAGER_ROLES.has(expectedManagerRole)) {
  console.error(
    `[inspect:community-membership] Abortado: COMMUNITY_MANAGER_ROLE=${expectedManagerRole || '(vazio)'} inválido.`
  );
  process.exit(1);
}

if (explicitMemberId && !SAFE_ID_PATTERN.test(explicitMemberId)) {
  console.error(
    '[inspect:community-membership] Abortado: COMMUNITY_DEBUG_MEMBER_ID inválido.'
  );
  process.exit(1);
}

initializeApp({ projectId, credential: applicationDefault() });

const auth = getAuth();
const db = getFirestore();

function timestampToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value.seconds === 'number') {
    return value.seconds * 1_000 + Math.trunc(Number(value.nanoseconds ?? 0) / 1_000_000);
  }
  return 0;
}

function formatTimestamp(value) {
  const millis = timestampToMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : '(ausente)';
}

function formatValue(value) {
  return value === undefined || value === null ? '(ausente)' : String(value);
}

let user;
try {
  if (email) {
    user = await auth.getUserByEmail(email);
  } else if (uid) {
    user = await auth.getUser(uid);
  } else {
    console.error(
      '[inspect:community-membership] Abortado: defina COMMUNITY_MANAGER_EMAIL (ou COMMUNITY_MODERATOR_EMAIL legado) com o e-mail da conta usada no app.'
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    '[inspect:community-membership] Não foi possível resolver a conta no Auth Emulator.',
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}

const targetMemberId = explicitMemberId || user.uid;
const communityRef = db.collection('communities').doc(communityId);
const membershipRef = communityRef.collection('members').doc(targetMemberId);
const activeOwnersQuery = communityRef
  .collection('members')
  .where('role', '==', 'owner')
  .where('status', '==', 'active')
  .limit(3);
const [
  communitySnapshot,
  membershipSnapshot,
  auditSnapshot,
  activeOwnersSnapshot,
] = await Promise.all([
  communityRef.get(),
  membershipRef.get(),
  db
    .collection('community_membership_audit')
    .where('subjectUid', '==', targetMemberId)
    .limit(100)
    .get(),
  activeOwnersQuery.get(),
]);

const community = communitySnapshot.data() ?? {};
const source = community.source ?? {};
const access = community.access ?? {};
const metrics = community.metrics ?? {};
const lifecycle = community.lifecycle ?? {};
const membership = membershipSnapshot.data() ?? {};

const latestAudit = auditSnapshot.docs
  .map((document) => ({ id: document.id, ...(document.data() ?? {}) }))
  .filter((entry) => entry.communityId === communityId)
  .sort(
    (left, right) =>
      timestampToMillis(right.createdAt) - timestampToMillis(left.createdAt)
  )[0] ?? null;

console.log('[inspect:community-membership] --- Auth do operador ---');
console.log(`Projeto=${projectId}`);
console.log(`Conta=${user.email ?? '(sem e-mail)'}`);
console.log(`UID=${user.uid}`);
console.log(`emailVerified=${user.emailVerified}`);
console.log(`disabled=${user.disabled}`);
console.log(`papelEsperado=${expectedManagerRole}`);

console.log('[inspect:community-membership] --- Comunidade ---');
console.log(`communityId=${communityId}`);
console.log(`exists=${communitySnapshot.exists}`);
console.log(`sourceType=${source.type ?? '(ausente)'}`);
console.log(`status=${community.status ?? '(ausente)'}`);
console.log(`join=${access.join ?? '(ausente)'}`);
console.log(`ownerUid=${community.ownerUid ?? '(ausente)'}`);
console.log(`activeOwnerCount=${activeOwnersSnapshot.size}`);
console.log(`memberCount=${formatValue(metrics.memberCount)}`);
console.log(`postCount=${formatValue(metrics.postCount)}`);
console.log(`mediaCount=${formatValue(metrics.mediaCount)}`);
console.log(`topicCount=${formatValue(metrics.topicCount)}`);
console.log(`lastMeaningfulActivityAt=${formatTimestamp(lifecycle.lastMeaningfulActivityAt)}`);
console.log(`archivedAt=${formatTimestamp(lifecycle.archivedAt ?? community.archivedAt)}`);
console.log(`scheduledForDeletionAt=${formatTimestamp(lifecycle.scheduledForDeletionAt)}`);
console.log(`retentionHold=${formatValue(lifecycle.retentionHold)}`);
console.log(`lifecyclePolicyVersion=${formatValue(lifecycle.policyVersion)}`);

console.log('[inspect:community-membership] --- Membership canônica ---');
console.log(`memberId=${targetMemberId}`);
console.log(`path=communities/${communityId}/members/${targetMemberId}`);
console.log(`exists=${membershipSnapshot.exists}`);
console.log(`status=${membership.status ?? '(ausente)'}`);
console.log(`role=${membership.role ?? '(ausente)'}`);
console.log(`source=${membership.source ?? '(ausente)'}`);
console.log(`seedScenario=${membership.seedScenario ?? '(ausente)'}`);
console.log(`leftAt=${formatTimestamp(membership.leftAt)}`);
console.log(`blockedAt=${formatTimestamp(membership.blockedAt)}`);
console.log(`blockedBy=${membership.blockedBy ?? '(ausente)'}`);
console.log(`blockedByRole=${membership.blockedByRole ?? '(ausente)'}`);
console.log(`blockedPreviousRole=${membership.blockedPreviousRole ?? '(ausente)'}`);
console.log(`updatedAt=${formatTimestamp(membership.updatedAt)}`);

console.log('[inspect:community-membership] --- Auditoria mais recente do alvo ---');
if (latestAudit) {
  console.log(`action=${latestAudit.action ?? '(ausente)'}`);
  console.log(`actorUid=${latestAudit.actorUid ?? '(ausente)'}`);
  console.log(`actorRole=${latestAudit.actorRole ?? '(ausente)'}`);
  console.log(`subjectUid=${latestAudit.subjectUid ?? '(ausente)'}`);
  console.log(`status=${latestAudit.status ?? latestAudit.resultStatus ?? '(ausente)'}`);
  console.log(`role=${latestAudit.role ?? latestAudit.resultRole ?? '(ausente)'}`);
  console.log(`source=${latestAudit.source ?? '(ausente)'}`);
  console.log(`createdAt=${formatTimestamp(latestAudit.createdAt)}`);
} else {
  console.log('Nenhum evento de auditoria encontrado para este alvo e Comunidade.');
}

if (!explicitMemberId) {
  if (membershipSnapshot.exists) {
    const managerMatches =
      membership.status === 'active'
      && membership.role === expectedManagerRole;
    const ownerMatches = expectedManagerRole !== 'owner'
      || (
        community.ownerUid === user.uid
        && activeOwnersSnapshot.size === 1
        && activeOwnersSnapshot.docs[0]?.id === user.uid
      );
    const expected = managerMatches && ownerMatches;
    console.log(
      `[inspect:community-membership] Resultado=${expected ? `GESTOR_ATIVO_${expectedManagerRole.toUpperCase()}` : 'DIVERGENTE_DO_SEED'}`
    );
  } else {
    console.log('[inspect:community-membership] Resultado=MEMBERSHIP_AUSENTE');
  }
} else {
  console.log('[inspect:community-membership] Resultado=ALVO_INSPECIONADO');
}
