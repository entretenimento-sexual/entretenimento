// src/app/core/services/interactions/friendship/repo/cooldown.repo.ts
// -----------------------------------------------------------------------------
// FRIEND REQUEST COOLDOWN REPOSITORY — READ ONLY
// -----------------------------------------------------------------------------
// O cooldown é estado de segurança/lifecycle produzido pelo backend. O cliente
// pode consultá-lo quando necessário, mas nunca criar ou alterar esse estado.
// -----------------------------------------------------------------------------
import { EnvironmentInjector, Injectable } from '@angular/core';
import { doc, Firestore, getDoc } from '@angular/fire/firestore';

import { FirestoreRepoBase } from './base.repo';

@Injectable({ providedIn: 'root' })
export class CooldownRepo extends FirestoreRepoBase {
  constructor(db: Firestore, env: EnvironmentInjector) {
    super(db, env);
  }

  cooldownKey(requesterUid: string, targetUid: string): string {
    return `${requesterUid}__${targetUid}`;
  }

  private getCooldownRef(requesterUid: string, targetUid: string) {
    return doc(
      this.db,
      `friendCooldowns/${this.cooldownKey(requesterUid, targetUid)}`
    );
  }

  readCooldown(requesterUid: string, targetUid: string) {
    return this.inCtx$(() =>
      getDoc(this.getCooldownRef(requesterUid, targetUid))
    );
  }
}
