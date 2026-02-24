// functions/src/presence/clearStalePresence.ts
// ✅ FUNÇÃO PARA LIMPAR PRESENÇA STALE
// - Roda a cada 2 minutos (ajustável via env)
// - Marca como offline usuários com lastSeen > janela (ex: 2 minutos)
// - Usa batch para eficiência (Firestore tem limite de 500 ops por batch)
// - Erros são logados mas não derrubam a função (best-effort)
// Não esquecer os comentários explicativos, para contextualizar a lógica e as decisões de design, especialmente em relação à presença online e à integração com o PresenceService. Isso ajuda a evitar confusões futuras sobre onde e como o status online deve ser controlado e lido, e reforça a ideia de que o estado online é derivado do Firestore, sem "simulações" em outros lugares (ex: Auth).
// Relação com o PresenceService (client):
// - PresenceService/PresenceWriterService atualizam `presence/{uid}` com:
//   - isOnline: boolean
//   - presenceState: 'online' | 'away' | 'offline'   (se você estiver usando)
//   - lastSeen: Timestamp (serverTimestamp)          (batimento/estado)
// - Multi-aba: só a aba líder escreve (LeaderElection).
// - Mesmo assim, quedas abruptas (crash, rede, encerramento) podem deixar `isOnline=true` “travado”.
//   Essa CF é o "safety net": se lastSeen passou da janela, força offline.
//
// Importante:
// - NÃO sobrescreve lastSeen aqui. lastSeen é “último visto” real do usuário.
// - Só marca offline (e opcionalmente registra staleClearedAt/offlineReason para auditoria).
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { db, FieldValue, Timestamp } from "../firebaseApp";

// ✅ type-only imports: não alteram runtime, só resolvem tipagem
import type {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  WriteBatch,
} from "firebase-admin/firestore";

setGlobalOptions({ region: "southamerica-east1", memory: "256MiB" });

const WINDOW_SEC = Number(process.env.PRESENCE_WINDOW_SEC || "120");

// Firestore: limite hard 500 ops/batch. Mantemos folga.
const MAX_BATCH_OPS = 450;

// Paginação simples (caso o volume cresça)
const PAGE_SIZE = 1000;

export const clearStalePresence = onSchedule("every 2 minutes", async () => {
  const cutoffTs = Timestamp.fromMillis(Date.now() - WINDOW_SEC * 1000);

  // ✅ Coleção correta: presence/{uid}
  // Query: isOnline==true && lastSeen < cutoff
  // Obs: pode exigir índice composto (isOnline + lastSeen).
  const baseQuery: Query<DocumentData> = db
    .collection("presence")
    .where("isOnline", "==", true)
    .where("lastSeen", "<", cutoffTs)
    .orderBy("lastSeen", "asc")
    .limit(PAGE_SIZE);

  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  try {
    while (true) {
      // ✅ Evita ternário no inicializador (resolve TS7022)
      let q: Query<DocumentData> = baseQuery;
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap: QuerySnapshot<DocumentData> = await q.get();
      if (snap.empty) break;

      let batch: WriteBatch = db.batch();
      let ops = 0;

      for (const d of snap.docs) {
        batch.update(d.ref, {
          isOnline: false,

          // Se você mantém presenceState no doc, é OK setar.
          // Se quiser ainda mais conservador, remova esta linha e deixe só isOnline=false.
          presenceState: "offline",

          // Auditoria opcional
          staleClearedAt: FieldValue.serverTimestamp(),
          offlineReason: "stale",
        });

        ops++;

        if (ops >= MAX_BATCH_OPS) {
          await safeCommit(batch, ops);
          batch = db.batch();
          ops = 0;
        }
      }

      if (ops > 0) await safeCommit(batch, ops);

      lastDoc = snap.docs[snap.docs.length - 1] ?? null;
      if (snap.size < PAGE_SIZE) break;
    }
  } catch (err) {
    // best-effort: loga e não derruba o agendador
    console.error("[clearStalePresence] fatal error:", err);
  }
});

async function safeCommit(batch: WriteBatch, ops: number) {
  try {
    await batch.commit();
    // console.log(`[clearStalePresence] committed ${ops} docs`);
  } catch (err) {
    console.error(`[clearStalePresence] batch commit failed (ops=${ops})`, err);
  }
}
