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

// Comentário: A função abaixo realiza a verificação do tipo de arquivo quando o plano Blaze estiver ativo.
// Quando o plano for migrado para Blaze, descomente o código abaixo para habilitar a verificação do tipo de arquivo.

// export const validateFileType = functions.storage.object().onFinalize(async (object) => {
//     const bucket = admin.storage().bucket(object.bucket);
//     const filePath = object.name || '';
//     const file = bucket.file(filePath);

//     // Verifica o tipo de arquivo
//     const [buffer] = await file.download();
//     const fileType = await import('file-type'); // Usando import dinâmico para carregar a biblioteca apenas quando necessário
//     const type = await fileType.fromBuffer(buffer);

//     const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

//     if (!type || !allowedTypes.includes(type.mime)) {
//         console.log('Arquivo rejeitado por tipo inválido:', type?.mime);
//         await file.delete();  // Exclui o arquivo inválido
//     } else {
//         console.log('Arquivo válido:', type.mime);
//     }
// });
