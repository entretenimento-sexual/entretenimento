// -----------------------------------------------------------------------------
// MIGRAÇÃO DE RESPOSTAS LEGADAS -> CONVERSA PLANA (EMULATOR ONLY)
// -----------------------------------------------------------------------------
// Idempotente: cada resposta legada recebe um ID determinístico e curto na
// coleção `comments`. Somente documentos efetivamente criados incrementam o
// contador da conversa. O script falha fechado fora do Emulator para evitar
// execução acidental em produção.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  console.error(
    '[migrate:community-replies] Abortado: FIRESTORE_EMULATOR_HOST ausente.'
  );
  process.exit(1);
}

function legacyConversationMessageId(sourcePath) {
  const digest = createHash('sha256')
    .update(sourcePath)
    .digest('hex')
    .slice(0, 40);
  return `legacy-reply-${digest}`;
}

initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();
const repliesSnapshot = await db.collectionGroup('replies').get();

if (repliesSnapshot.empty) {
  console.log('[migrate:community-replies] Nenhuma resposta legada encontrada.');
  process.exit(0);
}

const candidates = [];

for (const replySnapshot of repliesSnapshot.docs) {
  const repliesCollection = replySnapshot.ref.parent;
  const parentCommentRef = repliesCollection.parent;
  const commentsCollection = parentCommentRef?.parent;
  const postRef = commentsCollection?.parent;
  const itemsCollection = postRef?.parent;
  const communityFeedRef = itemsCollection?.parent;

  if (
    !parentCommentRef
    || !postRef
    || !communityFeedRef
    || commentsCollection?.id !== 'comments'
    || itemsCollection?.id !== 'items'
    || communityFeedRef.parent?.id !== 'community_feed_posts'
  ) {
    console.warn(
      `[migrate:community-replies] Caminho inesperado ignorado: ${replySnapshot.ref.path}`
    );
    continue;
  }

  const reply = replySnapshot.data() ?? {};
  const replyId = String(replySnapshot.id ?? '').trim();
  const actorUid = String(reply['actorUid'] ?? '').trim();
  const text = String(reply['text'] ?? '').trim();
  if (!replyId || !actorUid || !text) {
    console.warn(
      `[migrate:community-replies] Resposta inválida ignorada: ${replySnapshot.ref.path}`
    );
    continue;
  }

  const targetId = legacyConversationMessageId(replySnapshot.ref.path);
  candidates.push({
    source: replySnapshot,
    target: commentsCollection.doc(targetId),
    postRef,
    projectionRef: db
      .collection('community_public_feed')
      .doc(communityFeedRef.id)
      .collection('items')
      .doc(postRef.id),
    communityId: communityFeedRef.id,
    postId: postRef.id,
    parentCommentId: parentCommentRef.id,
    targetId,
    actorUid,
    reply,
  });
}

if (candidates.length === 0) {
  console.log('[migrate:community-replies] Nenhum candidato válido encontrado.');
  process.exit(0);
}

const targetSnapshots = await db.getAll(...candidates.map((candidate) => candidate.target));
const pending = candidates.filter((_, index) => !targetSnapshots[index].exists);

if (pending.length === 0) {
  console.log('[migrate:community-replies] Migração já estava concluída.');
  process.exit(0);
}

// Preflight: não cria mensagens se a projeção realtime correspondente estiver
// ausente, pois isso deixaria o contador público inconsistente.
const projectionSnapshots = await db.getAll(
  ...pending.map((candidate) => candidate.projectionRef)
);
const missingProjection = pending.find((_, index) => !projectionSnapshots[index].exists);
if (missingProjection) {
  console.error(
    `[migrate:community-replies] Abortado: projeção pública ausente para ${missingProjection.communityId}/${missingProjection.postId}. Nenhum dado foi alterado.`
  );
  process.exit(2);
}

const incrementsByPost = new Map();
const writer = db.bulkWriter();
let migrated = 0;

for (const candidate of pending) {
  const { reply } = candidate;
  writer.create(candidate.target, {
    commentId: candidate.targetId,
    communityId: candidate.communityId,
    postId: candidate.postId,
    actorUid: candidate.actorUid,
    author: reply['author'] ?? { label: 'Participante', avatarUrl: null },
    text: String(reply['text'] ?? '').trim(),
    replyToCommentId: candidate.parentCommentId,
    metrics: { replyCount: 0 },
    status: reply['status'] ?? 'active',
    moderationState: reply['moderationState'] ?? 'active',
    createdAt: reply['createdAt'] ?? new Date(),
    updatedAt: reply['updatedAt'] ?? reply['createdAt'] ?? new Date(),
    migration: {
      source: 'legacy-comment-reply',
      sourcePath: candidate.source.ref.path,
      sourceReplyId: candidate.source.id,
      migratedAt: Date.now(),
    },
  });

  writer.set(
    db.collection('community_feed_user_comments')
      .doc(candidate.actorUid)
      .collection('items')
      .doc(`${candidate.communityId}:${candidate.postId}:${candidate.targetId}`),
    {
      actorUid: candidate.actorUid,
      communityId: candidate.communityId,
      postId: candidate.postId,
      commentId: candidate.targetId,
      replyToCommentId: candidate.parentCommentId,
      createdAt: reply['createdAt'] ?? Date.now(),
      migratedFromLegacyReply: true,
    },
    { merge: true }
  );

  if (
    (reply['status'] ?? 'active') === 'active'
    && (reply['moderationState'] ?? 'active') === 'active'
  ) {
    const key = candidate.postRef.path;
    const current = incrementsByPost.get(key) ?? {
      postRef: candidate.postRef,
      projectionRef: candidate.projectionRef,
      count: 0,
    };
    current.count += 1;
    incrementsByPost.set(key, current);
  }
  migrated += 1;
}

await writer.close();

const counterWriter = db.bulkWriter();
for (const { postRef, projectionRef, count } of incrementsByPost.values()) {
  if (count <= 0) continue;
  counterWriter.update(postRef, {
    'metrics.commentCount': FieldValue.increment(count),
  });
  counterWriter.update(projectionRef, {
    'metrics.commentCount': FieldValue.increment(count),
  });
}
await counterWriter.close();

console.log(
  `[migrate:community-replies] Concluído: ${migrated} resposta(s) convertida(s) para a timeline plana.`
);
