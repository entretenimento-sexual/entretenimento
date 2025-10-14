// functions/src/presence/clearStalePresence.ts
// rever no plano blaze
import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2/options";

initializeApp();
setGlobalOptions({ region: "southamerica-east1", memory: "256MiB" });

const WINDOW_SEC = Number(process.env.PRESENCE_WINDOW_SEC || "120"); // 2 min
const MAX_BATCH = 450;

export const clearStalePresence = onSchedule("every 2 minutes", async () => {
  const db = getFirestore();
  const cutoffMs = Date.now() - WINDOW_SEC * 1000;

  console.info("[clearStalePresence] start", {
    windowSec: WINDOW_SEC,
    cutoff: new Date(cutoffMs).toISOString(),
  });

  const snap = await db.collection("users").where("isOnline", "==", true).get();
  if (snap.empty) {
    console.info("[clearStalePresence] nothing to do");
    return;
  }

  let updated = 0;
  let batch = db.batch();
  let opCount = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const ls = data.lastSeen as Timestamp | { seconds?: number } | number | undefined;

    const ms =
      ls instanceof Timestamp ? ls.toMillis() :
        typeof ls === "number" ? ls :
          ls && typeof ls === "object" && "seconds" in ls ? (ls.seconds ?? 0) * 1000 :
            0;

    if (!ms || ms < cutoffMs) {
      batch.update(d.ref, {
        isOnline: false,
        lastSeen: FieldValue.serverTimestamp(),
      });
      opCount++; updated++;
      if (opCount >= MAX_BATCH) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) await batch.commit();
  console.info("[clearStalePresence] updated:", updated);
});
