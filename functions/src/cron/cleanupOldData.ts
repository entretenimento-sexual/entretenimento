// functions/src/cron/cleanupOldData.ts
// -----------------------------------------------------------------------------
// CLEANUP OLD DATA
// -----------------------------------------------------------------------------
//
// Limpeza agendada de posts antigos.
//
// Decisões:
// - usa a região central das functions para permanecer próxima ao Firestore;
// - mantém janela atual de 30 dias;
// - utiliza batch para apagar os documentos retornados.
//
// Observação futura:
// - em volume elevado, esta rotina deverá ser paginada para respeitar limites
//   de batch e duração da execução.

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';

export const cleanupOldData = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const db = getFirestore();
    const cutoffTs = Timestamp.fromMillis(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    const oldPosts = await db
      .collection('posts')
      .where('createdAt', '<', cutoffTs)
      .get();

    const batch = db.batch();

    oldPosts.docs.forEach((document) => batch.delete(document.ref));

    await batch.commit();
  }
);