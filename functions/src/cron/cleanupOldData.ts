// functions/src/cron/cleanupOldData.ts
import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore, Timestamp} from "firebase-admin/firestore";

export const cleanupOldData = onSchedule("every 24 hours", async () => {
  const db = getFirestore();
  const cutoff = Timestamp.now().toMillis() - 30 * 24 * 60 * 60 * 1000; // 30 dias
  const oldPosts = await db.collection("posts").where("createdAt", "<", cutoff).get();

  const batch = db.batch();
  oldPosts.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  console.log("Posts antigos removidos.");
});
