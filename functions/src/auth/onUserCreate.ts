// functions/src/auth/onUserCreate.ts

import * as functions from "firebase-functions";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {initializeApp} from "firebase-admin/app";

initializeApp();

export const onUserCreate = functions.auth.user().onCreate((userRecord) => {
  const db = getFirestore();
  return db.collection("users").doc(userRecord.uid).set({
    email: userRecord.email,
    createdAt: FieldValue.serverTimestamp(),
    status: "active",
  });
});
