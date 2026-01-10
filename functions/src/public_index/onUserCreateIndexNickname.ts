// functions/src/public_index/onUserCreateIndexNickname.ts
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { db, FieldValue } from "../firebaseApp";

export const onUserCreateIndexNickname = onDocumentCreated("users/{userId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();
  const nickname = String(data?.nickname ?? "").trim().toLowerCase();
  if (!nickname) {
    console.log("[public_index] Ignorado: sem nickname");
    return;
  }
  await db.collection("public_index").doc(`nickname:${nickname}`).set({
    type: "nickname",
    value: nickname,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`[public_index] Nickname '${nickname}' indexado.`);
});
