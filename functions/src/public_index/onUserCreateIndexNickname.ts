// functions\src\public_index\onUserCreateIndexNickname.ts
import * as functions from "firebase-functions";
import {db, fieldValue} from "../firebaseApp";

export const onUserCreateIndexNickname = functions.firestore
  .document("users/{userId}")
  .onCreate(async (snapshot) => {
    const data = snapshot.data();

    if (!data?.nickname) {
      console.log("[public_index] Ignorado: sem nickname");
      return null;
    }

    const nickname = String(data.nickname).trim().toLowerCase();

    try {
      await db.collection("public_index").doc(`nickname:${nickname}`).set({
        type: "nickname",
        value: nickname,
        createdAt: fieldValue.serverTimestamp(),
      });
      console.log(`[public_index] Nickname '${nickname}' indexado.`);
    } catch (err) {
      console.error(`[public_index] Erro ao indexar nickname '${nickname}':`, err);
    }

    return null;
  });
