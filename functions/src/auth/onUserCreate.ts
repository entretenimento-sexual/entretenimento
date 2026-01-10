// functions/src/auth/onUserCreate.ts
import { auth } from "firebase-functions/v1";
import { db, FieldValue } from "../firebaseApp";

export const onUserCreate = auth.user().onCreate(async (user) => {
  await db.collection("users").doc(user.uid).set(
    {
      email: user.email ?? null,
      createdAt: FieldValue.serverTimestamp(),
      status: "active",
    },
    { merge: true }
  );
});
