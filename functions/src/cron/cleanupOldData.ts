// functions/src/cron/cleanupOldData.ts
import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore, Timestamp} from "firebase-admin/firestore";

export const cleanupOldData = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
    // considerar usar a hora do fuso do usuário
  },
  async () => {
    const db = getFirestore();
    const cutoffTs = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const oldPosts = await db.collection("posts")
      .where("createdAt", "<", cutoffTs)
      .get();

    const batch = db.batch();
    oldPosts.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
);
