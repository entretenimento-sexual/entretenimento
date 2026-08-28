// src/app/core/services/interactions/friendship/repo/cooldown.repo.ts
import { Injectable, EnvironmentInjector } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { FirestoreRepoBase } from './base.repo';
import { map } from 'rxjs';
import { Timestamp } from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class CooldownRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) { super(db, env); }

  cooldownKey(requesterUid: string, targetUid: string) {
    return `${requesterUid}__${targetUid}`;
  }

  getCooldownRef(requesterUid: string, targetUid: string) {
    return doc(this.db, `friendCooldowns/${this.cooldownKey(requesterUid, targetUid)}`);
  }

  readCooldown(requesterUid: string, targetUid: string) {
    return this.inCtx$(() => getDoc(this.getCooldownRef(requesterUid, targetUid)));
  }

  setCooldown(requesterUid: string, targetUid: string, until: Date) {
    const payload = {
      requesterUid, targetUid,
      until: Timestamp.fromDate(until),
      expiresAt: Timestamp.fromDate(until),
    };
    return this.inCtx$(() => setDoc(this.getCooldownRef(requesterUid, targetUid), payload))
      .pipe(map(() => void 0));
  }
}
