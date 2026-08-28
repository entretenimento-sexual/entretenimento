// src\app\messaging\direct-discovery\application\direct-discovery.facade.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
// Lembrar das imposições de restrições de participação em chats e mensagens
import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import {
  DEFAULT_DESIRED_FILTERS,
  DesiredFilters,
} from '../models/desired-filters.models';
import { DesiredProfile } from '../models/desired-profile.models';
import { DesiredProfileMatchingService } from '../services/desired-profile-matching.service';

@Injectable({ providedIn: 'root' })
export class DirectDiscoveryFacade {
  /**
   * Fonte temporária em memória.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - ainda não ligamos este domínio ao Firestore/query service do projeto
   * - ainda não conectamos aos filtros reais do perfil do usuário
   *
   * Motivo:
   * - primeiro consolidar o domínio novo sem conflitar com a arquitetura atual
   * - depois integrar dados reais com mais segurança
   */
  private readonly profilesSubject = new BehaviorSubject<DesiredProfile[]>([]);
  private readonly filtersSubject = new BehaviorSubject<DesiredFilters>(
    DEFAULT_DESIRED_FILTERS
  );

  readonly profiles$ = this.profilesSubject.asObservable().pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly filters$ = this.filtersSubject.asObservable().pipe(
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly visibleProfiles$: Observable<DesiredProfile[]> = combineLatest([
    this.profiles$,
    this.filters$,
  ]).pipe(
    map(([profiles, filters]) =>
      this.matchingService.filterAndRank(profiles, filters)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly matchingService: DesiredProfileMatchingService
  ) {}

  setProfiles(profiles: DesiredProfile[]): void {
    this.profilesSubject.next(Array.isArray(profiles) ? profiles : []);
  }

  setFilters(filters: DesiredFilters): void {
    this.filtersSubject.next({
      ...DEFAULT_DESIRED_FILTERS,
      ...(filters ?? {}),
    });
  }

  patchFilters(partial: Partial<DesiredFilters>): void {
    this.filtersSubject.next({
      ...this.filtersSubject.value,
      ...(partial ?? {}),
    });
  }

  resetFilters(): void {
    this.filtersSubject.next(DEFAULT_DESIRED_FILTERS);
  }
}
