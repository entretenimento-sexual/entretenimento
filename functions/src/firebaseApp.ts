// functions\src\firebaseApp.ts
import * as admin from "firebase-admin";

const app = admin.apps.length === 0 ? admin.initializeApp() : admin.app();

export const db = admin.firestore(app);
export const fieldValue = admin.firestore.FieldValue;
