// functions/src/moderation/moderation-safety-notification.service.ts
// -----------------------------------------------------------------------------
// MODERATION SAFETY NOTIFICATIONS
// -----------------------------------------------------------------------------
// Notificações idempotentes e com conteúdo mínimo:
// - nunca revelam a identidade do denunciante;
// - não expõem detalhes internos de investigação;
// - push externo continua neutro pela política global de notificações;
// - detalhes ficam somente na central autenticada.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';

import { db, FieldValue } from '../firebaseApp';

interface ModerationReportSnapshot {
  reporterUid?: unknown;
  targetType?: unknown;
  targetOwnerUid?: unknown;
  targetAuthorUid?: unknown;
  reason?: unknown;
  status?: unknown;
  moderationAction?: unknown;
  contentQuarantined?: unknown;
  ageReverificationCaseId?: unknown;
  ageReverificationStatus?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,180}$/.test(normalized) ? normalized : '';
}

function notificationId(
  reportId: string,
  audience: string,
  event: string
): string {
  return `mod_${createHash('sha256')
    .update([reportId, audience, event].join('|'))
    .digest('hex')
    .slice(0, 40)}`;
}

function targetLabel(targetType: string): string {
  switch (targetType) {
    case 'photo':
      return 'foto';
    case 'video':
      return 'vídeo';
    case 'video_comment':
      return 'comentário';
    case 'video_rating':
      return 'avaliação';
    case 'community_feed_post':
      return 'publicação';
    case 'community_feed_comment':
      return 'comentário';
    case 'community_feed_comment_reply':
      return 'resposta';
    case 'profile':
      return 'perfil';
    default:
      return 'conteúdo';
  }
}

async function writeNotification(input: {
  id: string;
  userId: string;
  type: 'system' | 'compliance.violation.suspected' | 'compliance.action.taken';
  title: string;
  body: string;
  route: string;
  actionRequired?: boolean;
  caseId?: string | null;
  responseDueAt?: number | null;
}): Promise<void> {
  const userId = cleanId(input.userId);
  if (!userId) return;

  await db.collection('notifications').doc(input.id).set({
    userId,
    type: input.type,
    title: input.title,
    body: input.body,
    route: input.route,
    actionRequired: input.actionRequired === true,
    caseId: cleanId(input.caseId) || null,
    responseDueAt:
      Number.isFinite(Number(input.responseDueAt)) &&
      Number(input.responseDueAt) > 0
        ? Math.trunc(Number(input.responseDueAt))
        : null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function readReport(
  reportIdValue: string
): Promise<{ reportId: string; report: ModerationReportSnapshot } | null> {
  const reportId = cleanId(reportIdValue);
  if (!reportId) return null;

  const snapshot = await db.collection('moderation_reports').doc(reportId).get();
  if (!snapshot.exists) return null;

  return {
    reportId,
    report: snapshot.data() as ModerationReportSnapshot,
  };
}

export async function notifyModerationReportOpened(
  reportIdValue: string
): Promise<void> {
  const loaded = await readReport(reportIdValue);
  if (!loaded) return;

  const { reportId, report } = loaded;
  const reporterUid = cleanId(report.reporterUid);
  const targetUid = cleanId(report.targetAuthorUid) ||
    cleanId(report.targetOwnerUid);
  const targetType = String(report.targetType ?? '').trim();
  const critical =
    report.reason === 'minor_safety' ||
    report.reason === 'minor_content_safety';
  const quarantined = report.contentQuarantined === true;

  if (reporterUid) {
    await writeNotification({
      id: notificationId(reportId, 'reporter', 'received'),
      userId: reporterUid,
      type: 'system',
      title: critical ? 'Denúncia de segurança recebida' : 'Denúncia recebida',
      body: critical
        ? 'Recebemos sua denúncia e ela foi priorizada para análise de segurança.'
        : 'Recebemos sua denúncia e ela foi encaminhada para análise.',
      route: '/notificacoes',
    });
  }

  if (quarantined && targetUid && targetUid !== reporterUid) {
    const label = targetLabel(targetType);
    await writeNotification({
      id: notificationId(reportId, 'target', 'quarantined'),
      userId: targetUid,
      type: 'compliance.action.taken',
      title: 'Conteúdo temporariamente indisponível',
      body:
        `Uma ${label} foi temporariamente retirada da distribuição enquanto passa por análise de segurança. A medida é preventiva e não representa conclusão da revisão.`,
      route: '/notificacoes',
      actionRequired: false,
    });
  }
}

export async function notifyModerationReportReviewed(
  reportIdValue: string
): Promise<void> {
  const loaded = await readReport(reportIdValue);
  if (!loaded) return;

  const { reportId, report } = loaded;
  const reporterUid = cleanId(report.reporterUid);
  const targetUid = cleanId(report.targetAuthorUid) ||
    cleanId(report.targetOwnerUid);
  const targetType = String(report.targetType ?? '').trim();
  const action = String(report.moderationAction ?? '').trim().toUpperCase();
  const wasQuarantined = report.contentQuarantined === true;
  const isCommunity = targetType.startsWith('community_feed_');

  if (reporterUid) {
    await writeNotification({
      id: notificationId(reportId, 'reporter', 'reviewed'),
      userId: reporterUid,
      type: 'system',
      title: 'Análise da denúncia concluída',
      body:
        'A análise foi concluída. Quando necessário, medidas compatíveis com as políticas da plataforma foram aplicadas.',
      route: '/notificacoes',
    });
  }

  if (!targetUid || targetUid === reporterUid || targetType === 'profile') {
    return;
  }

  if (action === 'KEEP' && wasQuarantined) {
    await writeNotification({
      id: notificationId(reportId, 'target', 'restored'),
      userId: targetUid,
      type: 'compliance.action.taken',
      title: 'Conteúdo restaurado',
      body:
        `A ${targetLabel(targetType)} que estava temporariamente indisponível foi restaurada após revisão.`,
      route: '/notificacoes',
    });
    return;
  }

  // Comunidades já possuem notificação específica de remoção com rota contextual.
  if (action === 'REMOVE' && !isCommunity) {
    await writeNotification({
      id: notificationId(reportId, 'target', 'removed'),
      userId: targetUid,
      type: 'compliance.action.taken',
      title: 'Conteúdo removido após revisão',
      body:
        `A ${targetLabel(targetType)} denunciada foi removida após revisão de moderação. Consulte a Central de Notificações para acompanhar medidas aplicadas à conta.`,
      route: '/notificacoes',
      actionRequired: false,
    });
  }
}

export async function notifyAgeReverificationRequired(input: {
  reportId: string;
  caseId: string;
  targetUid: string;
  dueAt: number;
}): Promise<void> {
  const reportId = cleanId(input.reportId);
  const caseId = cleanId(input.caseId);
  const targetUid = cleanId(input.targetUid);
  if (!reportId || !caseId || !targetUid) return;

  await writeNotification({
    id: notificationId(reportId, 'target', 'age-reverification-required'),
    userId: targetUid,
    type: 'compliance.violation.suspected',
    title: 'Revalidação de idade necessária',
    body:
      'Sua conta precisa concluir uma revalidação de idade. O perfil e algumas interações permanecem restritos enquanto a verificação estiver pendente.',
    route: '/adulto/revalidar',
    actionRequired: true,
    caseId,
    responseDueAt: input.dueAt,
  });
}

export async function notifyAgeReverificationOutcome(
  reportIdValue: string
): Promise<void> {
  const loaded = await readReport(reportIdValue);
  if (!loaded) return;

  const { reportId, report } = loaded;
  const reporterUid = cleanId(report.reporterUid);
  const targetUid = cleanId(report.targetOwnerUid);
  const caseId = cleanId(report.ageReverificationCaseId) || null;
  const status = String(report.ageReverificationStatus ?? '')
    .trim()
    .toUpperCase();

  if (targetUid) {
    const verified = status === 'VERIFIED';
    await writeNotification({
      id: notificationId(reportId, 'target', 'age-reverification-outcome'),
      userId: targetUid,
      type: 'compliance.action.taken',
      title: 'Revalidação de idade concluída',
      body: verified
        ? 'A revalidação de idade foi concluída. Consulte o status da conta para confirmar o acesso disponível.'
        : 'A revalidação de idade foi concluída e a conta permanece sujeita a restrições de segurança. Consulte o status da conta e os canais de revisão.',
      route: '/conta/status',
      actionRequired: !verified,
      caseId,
    });
  }

  if (reporterUid) {
    await writeNotification({
      id: notificationId(reportId, 'reporter', 'age-reverification-outcome'),
      userId: reporterUid,
      type: 'system',
      title: 'Denúncia de segurança analisada',
      body:
        'A análise relacionada à denúncia de segurança foi concluída. Por privacidade, detalhes da conta analisada não são compartilhados.',
      route: '/notificacoes',
    });
  }
}

export async function safeNotifyModerationReportOpened(
  reportId: string
): Promise<void> {
  try {
    await notifyModerationReportOpened(reportId);
  } catch (error) {
    logger.error('[moderationNotification] falha ao notificar abertura', {
      reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function safeNotifyModerationReportReviewed(
  reportId: string
): Promise<void> {
  try {
    await notifyModerationReportReviewed(reportId);
  } catch (error) {
    logger.error('[moderationNotification] falha ao notificar revisão', {
      reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function safeNotifyAgeReverificationRequired(
  input: {
    reportId: string;
    caseId: string;
    targetUid: string;
    dueAt: number;
  }
): Promise<void> {
  try {
    await notifyAgeReverificationRequired(input);
  } catch (error) {
    logger.error('[moderationNotification] falha ao notificar revalidação', {
      reportId: input.reportId,
      targetUid: input.targetUid,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function safeNotifyAgeReverificationOutcome(
  reportId: string
): Promise<void> {
  try {
    await notifyAgeReverificationOutcome(reportId);
  } catch (error) {
    logger.error('[moderationNotification] falha ao notificar resultado etário', {
      reportId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
