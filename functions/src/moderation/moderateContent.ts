// functions/src/moderation/moderateContent.ts
import {onDocumentCreated} from "firebase-functions/v2/firestore";


export const moderateContent = onDocumentCreated("posts/{postId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const post = snap.data();
  if (post?.text?.includes("palavra proibida")) {
    await snap.ref.update({status: "pending_review"});
    console.log(`Post ${snap.id} marcado para revisão.`);
  }
});
