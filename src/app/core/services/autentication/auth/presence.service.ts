// src/app/core/services/autentication/auth/presence.service.ts
import { Injectable, NgZone, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, updateDoc, serverTimestamp as fsServerTimestamp } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class PresenceService {
  private timer?: any;
  private uid?: string;

  private beforeUnloadHandler?: () => void;
  private pageHideHandler?: () => void;
  private offlineHandler?: () => void;
  private visibilityHandler?: () => void;

  // enquanto sua UI ainda usa where('isOnline','==',true), mantemos compat:
  private static readonly KEEP_ISONLINE_COMPAT = true;

  constructor(
    private db: Firestore,
    private zone: NgZone,
    private injector: Injector
  ) { }

  private run<T>(fn: () => T): T {
    return runInInjectionContext(this.injector, fn);
  }

  private safeUpdate(uid: string, data: Record<string, unknown>): void {
    this.run(() => {
      const ref = doc(this.db, 'users', uid);
      updateDoc(ref, data as any).catch(() => { });
    });
  }

  start(uid: string): void {
    if (!uid || this.timer) return;
    this.uid = uid;

    const beat = () =>
      this.safeUpdate(uid, {
        lastSeen: fsServerTimestamp(),
        ...(PresenceService.KEEP_ISONLINE_COMPAT ? { isOnline: true } : null),
      });

    // 1ª atualização imediata
    beat();

    // Heartbeat a cada 30s fora da zone (sem repintar Angular)
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        beat();
      }, 30_000);
    });

    // Handlers (best-effort) – sempre via safeUpdate
    this.beforeUnloadHandler = () => this.safeUpdate(uid, { isOnline: false, lastOfflineAt: fsServerTimestamp() });
    this.pageHideHandler = () => this.safeUpdate(uid, { isOnline: false, lastOfflineAt: fsServerTimestamp() });
    this.offlineHandler = () => this.safeUpdate(uid, { isOnline: false, lastOfflineAt: fsServerTimestamp() });
    this.visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.safeUpdate(uid, { lastSeen: fsServerTimestamp() });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
      window.addEventListener('pagehide', this.pageHideHandler as any);
      window.addEventListener('offline', this.offlineHandler as any);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler as any);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (typeof window !== 'undefined') {
      if (this.beforeUnloadHandler) window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      if (this.pageHideHandler) window.removeEventListener('pagehide', this.pageHideHandler as any);
      if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler as any);
    }
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler as any);
    }
    this.beforeUnloadHandler = undefined;
    this.pageHideHandler = undefined;
    this.offlineHandler = undefined;
    this.visibilityHandler = undefined;
    this.uid = undefined;
  }
}
