// src/app/core/services/batepapo/invite-service/invite-search.service.ts
// -----------------------------------------------------------------------------
// Busca compatível de perfis para convites legados de Room.
//
// Room está congelado: nenhuma feature nova é adicionada aqui. A única
// responsabilidade mantida é impedir que a superfície histórica volte a
// enumerar /users. A busca usa a projeção pública backend-time canônica.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import type { QueryConstraint } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { IUserDados } from '../../../interfaces/iuser-dados';
import {
  PublicProfileReadBoundaryService,
} from '../../discovery/public-profile-read-boundary.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class InviteSearchService {
  constructor(
    private readonly publicProfileRead: PublicProfileReadBoundaryService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  private debugLog(message: string, payload?: unknown): void {
    if (environment.enableDebugTools) {
      console.debug('[InviteSearchService]', message, payload ?? '');
    }
  }

  /**
   * Compatibilidade residual para /chat/rooms.
   *
   * QueryConstraint não possui contrato público estável de serialização.
   * Para não depender de internals do SDK nem reabrir /users, filtros genéricos
   * são recusados. A ação final de convite continua sendo validada no backend.
   */
  searchEligibleUsers(
    roomId: string,
    searchTerm = '',
    filters: QueryConstraint[] = []
  ): Observable<IUserDados[]> {
    const normalizedTerm = String(searchTerm ?? '').trim().toLowerCase();
    const safeFilters = (filters ?? []).filter(Boolean);

    if (safeFilters.length > 0) {
      this.debugLog('Filtros legados não serializáveis foram recusados.', {
        roomId,
        filtersCount: safeFilters.length,
      });
      return of([]);
    }

    return this.publicProfileRead.read$({
      mode: 'all',
      pageSize: 40,
      filters: normalizedTerm
        ? { nicknamePrefix: normalizedTerm }
        : null,
    }).pipe(
      map((response) => {
        const profiles = (response.items ?? [])
          .map((raw) => ({
            ...(raw as unknown as IUserDados),
            uid: String(raw['uid'] ?? '').trim(),
            age: null,
          }))
          .filter((profile) => !!profile.uid);

        // public_profiles não carrega roomIds. Room é superfície histórica:
        // não duplicamos estado privado aqui; a ação backend rejeita vínculo
        // inválido/duplicado quando necessário.
        this.debugLog('Perfis elegíveis carregados pela boundary pública.', {
          roomId,
          count: profiles.length,
        });

        return profiles;
      }),
      catchError((err) => {
        this.routeError(
          err,
          'searchEligibleUsers',
          'Erro ao buscar usuários elegíveis.'
        );
        return of([] as IUserDados[]);
      })
    );
  }

  validateAndExpandFilters(filters: QueryConstraint[]): QueryConstraint[] {
    const safe = (filters ?? []).filter(Boolean);

    this.debugLog('validateAndExpandFilters', {
      count: safe.length,
      supported: safe.length === 0,
    });

    return safe;
  }

  private routeError(
    err: unknown,
    context: string,
    userMessage?: string
  ): void {
    const e = err instanceof Error
      ? err
      : new Error(`[InviteSearchService] ${context}`);

    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;

    this.globalError.handleError(e);

    if (userMessage) {
      this.notify.showError(userMessage);
    }
  }
}
