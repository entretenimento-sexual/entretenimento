// functions/src/notifications/sendNotification.ts
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {getFirestore} from "firebase-admin/firestore";

export const sendNotification = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const notification = snap.data();
  if (!notification?.userId) return;

  const db = getFirestore();
  const userDoc = await db.collection("users").doc(notification.userId).get();
  const fcmToken = userDoc.data()?.fcmToken;

  if (fcmToken) {
    await getMessaging().send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
    });
    console.log(`Notificação enviada para ${notification.userId}`);
  }
});
