import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import type { PublicProfileCard } from '../models/public-profile-card.model';

type VisualState = 'cards' | 'filtered' | 'error';

interface DiscoveryPublicProfilesState {
  readonly profiles: readonly PublicProfileCard[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly refreshing: boolean;
  readonly hasMore: boolean;
  readonly errorMessage: string | null;
  readonly emptyMessage: string;
  readonly filteredByPreferences: boolean;
}

const VISUAL_CARDS: readonly PublicProfileCard[] = [
  card('visual-ana', 'Ana', 29, 'mulher', 'heterossexual', true, 3.4),
  card('visual-bruno', 'Bruno', 33, 'homem', 'bissexual', false, 5.8),
  card('visual-carla', 'Carla', 36, 'mulher', 'bissexual', true, 8.1),
  card('visual-diego', 'Diego', 31, 'homem', 'heterossexual', false, 12.6),
  card('visual-elisa', 'Elisa', 27, 'mulher', 'homossexual', true, 16.2),
  card('visual-felipe', 'Felipe', 39, 'homem', 'bissexual', false, 20.4),
];

@Injectable({ providedIn: 'root' })
export class DiscoveryPublicProfilesFacade {
  private readonly router = inject(Router);
  private readonly stateSubject = new BehaviorSubject<DiscoveryPublicProfilesState>(
    this.resolveInitialState()
  );

  readonly state$ = this.stateSubject.asObservable().pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly profiles$ = this.state$.pipe(map((state) => state.profiles));
  readonly loading$ = this.state$.pipe(map((state) => state.loading));
  readonly loadingMore$ = this.state$.pipe(map((state) => state.loadingMore));
  readonly refreshing$ = this.state$.pipe(map((state) => state.refreshing));
  readonly hasMore$ = this.state$.pipe(map((state) => state.hasMore));
  readonly errorMessage$ = this.state$.pipe(map((state) => state.errorMessage));
  readonly emptyMessage$ = this.state$.pipe(map((state) => state.emptyMessage));
  readonly filteredByPreferences$ = this.state$.pipe(
    map((state) => state.filteredByPreferences)
  );

  loadMore(): void {
    this.stateSubject.next(this.cardsState());
  }

  refresh(): void {
    this.stateSubject.next(this.cardsState());
  }

  retry(): void {
    this.refresh();
  }

  private resolveInitialState(): DiscoveryPublicProfilesState {
    const state = this.readVisualState();

    if (state === 'filtered') {
      return {
        profiles: [],
        loading: false,
        loadingMore: false,
        refreshing: false,
        hasMore: true,
        errorMessage: null,
        emptyMessage: 'Nenhum perfil corresponde aos filtros desta página.',
        filteredByPreferences: true,
      };
    }

    if (state === 'error') {
      return {
        profiles: [],
        loading: false,
        loadingMore: false,
        refreshing: false,
        hasMore: false,
        errorMessage: 'Não foi possível carregar os perfis agora.',
        emptyMessage: 'Nenhum perfil disponível agora.',
        filteredByPreferences: false,
      };
    }

    return this.cardsState();
  }

  private cardsState(): DiscoveryPublicProfilesState {
    return {
      profiles: VISUAL_CARDS,
      loading: false,
      loadingMore: false,
      refreshing: false,
      hasMore: true,
      errorMessage: null,
      emptyMessage: 'Nenhum perfil disponível agora.',
      filteredByPreferences: false,
    };
  }

  private readVisualState(): VisualState {
    const query = this.router.url.split('?')[1] ?? '';
    const state = new URLSearchParams(query).get('visualState');
    return state === 'filtered' || state === 'error' ? state : 'cards';
  }
}

function card(
  uid: string,
  nickname: string,
  age: number,
  gender: string,
  orientation: string,
  isOnline: boolean,
  distanceKm: number
): PublicProfileCard {
  return {
    uid,
    nickname,
    nicknameNormalized: nickname.toLowerCase(),
    photoURL: 'assets/imagem-padrao.webp',
    gender,
    orientation,
    age,
    municipio: 'Rio de Janeiro',
    estado: 'RJ',
    role: 'free',
    isOnline,
    lastSeen: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    publicRelationshipIntents: ['dating'],
    preferenceBadgesVisible: true,
    publicPreferencesUpdatedAt: Date.now() - 60_000,
    ...({ distanciaKm: distanceKm } as Record<string, unknown>),
  } as PublicProfileCard;
}
