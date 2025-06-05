// functions/src/auth/onUserCreate.ts
import * as functions from "firebase-functions";
import {db, fieldValue} from "../firebaseApp";

export const onUserCreate = functions.auth.user().onCreate((userRecord) => {
  return db.collection("users").doc(userRecord.uid).set({
    email: userRecord.email,
    createdAt: fieldValue.serverTimestamp(),
    status: "active",
  });
});
