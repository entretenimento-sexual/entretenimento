//functions\src\index.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { CallableContext } from 'firebase-functions/v1/https';


admin.initializeApp();

interface InviteData {
  roomId: string;
}

exports.generateInviteToken = functions.https.onCall((data: InviteData, context: CallableContext) => {
  // Verifique se o usuário está autenticado
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'O usuário deve estar autenticado para criar convites.');
  }

  const roomId = data.roomId;
  const userId = context.auth.uid;
  const inviteToken = admin.firestore().collection('invites').doc();

  return inviteToken.set({
    roomId: roomId,
    createdBy: userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    validUntil: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // Validade de 24 horas
  }).then(() => {
    return { token: inviteToken.id };
  });
});
