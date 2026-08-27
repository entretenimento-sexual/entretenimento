import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import type { PublicProfileCard } from 'src/app/dashboard/discovery/models/public-profile-card.model';

export interface CompatibleProfileCandidatePool {
  readonly ownerUids: readonly string[];
  readonly hasMore: boolean;
  readonly loadingInitial: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly initialized: boolean;
  readonly error: string | null;
}

const VISUAL_COMPATIBLES: readonly PublicProfileCard[] = [
  profile('visual-compatible-1', 'Marina', 31),
  profile('visual-compatible-2', 'Rafael', 34),
  profile('visual-compatible-3', 'Bianca', 29),
];

/**
 * Contrato determinístico do pool compatível usado somente pelo harness visual.
 *
 * SUPRESSÃO EXPLÍCITA DO HARNESS:
 * - não dispara Discovery V2 real;
 * - não pagina perfis reais;
 * - não grava NgRx nem Firestore.
 *
 * O objetivo é manter o mesmo contrato público do serviço de produção para que
 * todos os arquivos do programa TypeScript continuem compilando durante os
 * fileReplacements visuais.
 */
@Injectable({ providedIn: 'root' })
export class CompatibleProfileCandidatesService {
  readonly profiles$: Observable<readonly PublicProfileCard[]> = of([
    ...VISUAL_COMPATIBLES,
  ]).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  readonly ownerUids$: Observable<readonly string[]> = this.profiles$.pipe(
    map((profiles) => profiles.map((profile) => profile.uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly pool$: Observable<CompatibleProfileCandidatePool> =
    this.ownerUids$.pipe(
      map((ownerUids) => ({
        ownerUids,
        hasMore: false,
        loadingInitial: false,
        loadingMore: false,
        refreshing: false,
        initialized: true,
        error: null,
      })),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  loadMore$(): Observable<boolean> {
    return of(false);
  }

  refresh(): void {
    // Dados fixos do harness; não há backend para atualizar.
  }
}

function profile(uid: string, nickname: string, age: number): PublicProfileCard {
  return {
    uid,
    nickname,
    nicknameNormalized: nickname.toLowerCase(),
    photoURL: null,
    gender: 'não informado',
    orientation: 'não informada',
    age,
    municipio: 'Rio de Janeiro',
    estado: 'RJ',
    role: 'free',
    isOnline: true,
    lastSeen: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    publicRelationshipIntents: ['dating'],
    preferenceBadgesVisible: true,
    publicPreferencesUpdatedAt: Date.now() - 60_000,
  } as PublicProfileCard;
}
