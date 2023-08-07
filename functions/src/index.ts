// functions\src\index.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

exports.deleteCommunity = functions.firestore
  .document('/users/{userId}')
  .onUpdate((change, context) => {
    const previousValue = change.before.data();
    const newValue = change.after.data();

    if (previousValue?.role === 'extase' && newValue?.role !== 'extase') {
      // Código para deletar a "community" e enviar email
    }
  });
