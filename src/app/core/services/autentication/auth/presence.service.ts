// src/app/core/services/autentication/auth/presence.service.ts
import { Injectable, NgZone } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, updateDoc, serverTimestamp as fsServerTimestamp } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })

export class PresenceService {
  private heartbeatTimer: any = null;
  private beforeUnloadHandler?: () => void;

  constructor(
              private db: Firestore, // ✅ Injeta o Firestore diretamente
              private zone: NgZone
              ) { }

  start(uid: string): void {
    if (!uid) return;
    if (this.heartbeatTimer) return;

    const userRef = doc(this.db, 'users', uid);

    const tick = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      updateDoc(userRef, { isOnline: true, lastSeen: fsServerTimestamp() }).catch(() => { });
    };

    tick();
    this.heartbeatTimer = setInterval(tick, 30_000);

    this.beforeUnloadHandler = () => {
      updateDoc(userRef, { isOnline: false, lastSeen: fsServerTimestamp() }).catch(() => { });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
      window.addEventListener('offline', () => {
        updateDoc(userRef, { isOnline: false, lastSeen: fsServerTimestamp() }).catch(() => { });
      });
      window.addEventListener('online', () => tick());
    }
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (typeof window !== 'undefined' && this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = undefined;
    }
  }
}
