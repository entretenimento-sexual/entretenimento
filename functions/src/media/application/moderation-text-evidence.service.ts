import { db, FieldValue } from '../../firebaseApp';
import { MODERATION_EVIDENCE_COLLECTION } from './moderation-evidence-preservation.service';
import type { MediaReportSafetyReason } from './media-report-safety';

interface ModerationTextEvidenceInput {
  reportId: string;
  ownerUid: string;
  parentMediaId: string;
  targetId: string;
  targetAuthorUid: string;
  reason: MediaReportSafetyReason;
  content: string;
  contentCreatedAt?: unknown;
  parentTargetId?: string | null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  const normalized = String(value ?? '').trim().slice(0, maxLength);
  return normalized || null;
}

function normalizeTimestampNumber(value: unknown): number | null {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.floor(numberValue)
    : null;
}

/**
 * Cria uma fotografia imutável do texto denunciado na mesma transação que
 * cria o report. O cliente nunca recebe leitura direta desse documento.
 *
 * A preservação não conclui que houve crime e não autoriza compartilhamento
 * informal: ela apenas impede que a moderação apague o único exemplar do
 * conteúdo antes de uma revisão ou de eventual requisição legal válida.
 */
export function preserveModerationTextEvidenceInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: ModerationTextEvidenceInput
): void {
  const evidenceRef = db
    .collection(MODERATION_EVIDENCE_COLLECTION)
    .doc(input.reportId);
  const timestamp = FieldValue.serverTimestamp();

  transaction.create(evidenceRef, {
    reportId: input.reportId,
    evidenceType: 'TEXT_SNAPSHOT',
    mediaType: 'VIDEO_COMMENT',
    ownerUid: input.ownerUid,
    mediaId: input.parentMediaId,
    targetId: input.targetId,
    targetAuthorUid: input.targetAuthorUid,
    parentTargetId: cleanText(input.parentTargetId, 128),
    reason: input.reason,
    textSnapshot: cleanText(input.content, 500),
    contentCreatedAt: normalizeTimestampNumber(input.contentCreatedAt),
    retentionStatus: 'MODERATION_REVIEW',
    accessPolicy: 'BACKEND_ONLY',
    preservedAt: timestamp,
    updatedAt: timestamp,
  });
}
