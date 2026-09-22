// functions/src/compliance/expire-age-eligibility.schedule.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY EXPIRATION RECOVERY SWEEP
// -----------------------------------------------------------------------------
// A expiração pontual é agendada por Cloud Tasks no expiresAt. Este job não é
// mais a fronteira primária de segurança: funciona como fallback de recuperação
// para tarefas perdidas/atrasadas e para registros antigos ainda não agendados.
//
// Segurança/custo:
// - consulta indexada apenas a autoridade canônica;
// - lote limitado por execução;
// - cada candidato é relido no materializador transacional;
// - uma reverificação concorrente sempre vence;
// - nunca deriva maioridade de campos do usuário.
// -----------------------------------------------------------------------------

import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, Timestamp } from '../firebaseApp';
import {
  materializeExpiredAgeEligibility,
} from './expire-age-eligibility.service';

const MAX_RECORDS_PER_RUN = 500;
const TRANSACTION_CONCURRENCY = 10;

async function processChunk(
  uids: readonly string[],
  nowMs: number
): Promise<number> {
  const results = await Promise.all(
    uids.map(async (uid) => {
      const result = await materializeExpiredAgeEligibility(uid, nowMs);
      return result.expired ? 1 : 0;
    })
  );

  return results.reduce<number>((sum, value) => sum + value, 0);
}

export const expireAgeEligibilityRecords = onSchedule(
  {
    schedule: '* * * * *',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 240,
  },
  async () => {
    const nowMs = Date.now();
    const snapshot = await db
      .collection('age_eligibility_records')
      .where('status', '==', 'VERIFIED_ADULT')
      .where('expiresAt', '<=', Timestamp.fromMillis(nowMs))
      .orderBy('expiresAt', 'asc')
      .limit(MAX_RECORDS_PER_RUN)
      .get();

    let expired = 0;
    const uids = snapshot.docs.map((document) => document.id);

    for (
      let index = 0;
      index < uids.length;
      index += TRANSACTION_CONCURRENCY
    ) {
      expired += await processChunk(
        uids.slice(index, index + TRANSACTION_CONCURRENCY),
        nowMs
      );
    }

    console.log('[ageEligibility] Sweep de recuperação concluído.', {
      candidates: uids.length,
      expired,
      capped: snapshot.size >= MAX_RECORDS_PER_RUN,
      nowMs,
    });
  }
);
