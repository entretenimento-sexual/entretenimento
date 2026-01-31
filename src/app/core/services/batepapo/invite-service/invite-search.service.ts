// src/app/core/services/batepapo/invite-search.service.ts
// Serviço para buscar usuários elegíveis para convite em bate-papo
// - Busca por nicknameLowerCase (prefix search)
// - Permite filtros adicionais (QueryConstraint[])
// - Filtra no client usuários já vinculados à sala (roomIds)
// - Tratamento de erros centralizado (GlobalErrorHandlerService + ErrorNotificationService)
// - Observable-first (evita try/catch “falso” e Promises na API pública)

import { Injectable } from '@angular/core';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { IUserDados } from '../../../interfaces/iuser-dados';

import {
  QueryConstraint,
  where,
  collection,
  query,
  getDocs,
  orderBy,
  limit,
} from '@angular/fire/firestore';

import { Observable, of, defer } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';

import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class InviteSearchService {
  constructor(
    private firestoreQueryService: FirestoreQueryService,
    private notify: ErrorNotificationService,
    private globalError: GlobalErrorHandlerService
  ) { }

  /** Helper: log apenas em dev/staging */
  private debugLog(message: string, payload?: unknown): void {
    if (environment.enableDebugTools) {
      console.debug('[InviteSearchService]', message, payload ?? '');
    }
  }

  /**
   * Monta QueryConstraints com base em:
   * - searchTerm (prefix search em nicknameLowerCase)
   * - filtros adicionais (expansível)
   *
   * Obs.: como usamos range (>= e <=) em nicknameLowerCase, adicionamos orderBy no mesmo campo
   * para evitar comportamento inconsistente e alinhar com requisitos de query.
   */
  private buildQueryConstraints(
    searchTerm: string,
    filters: QueryConstraint[]
  ): { constraints: QueryConstraint[]; needsOrderBy: boolean } {
    const constraints = [...(filters ?? [])];
    let needsOrderBy = false;

    if (searchTerm?.trim()) {
      const normalizedTerm = searchTerm.trim().toLowerCase();
      constraints.push(where('nicknameLowerCase', '>=', normalizedTerm));
      constraints.push(where('nicknameLowerCase', '<=', normalizedTerm + '\uf8ff'));
      needsOrderBy = true;
    }

    return { constraints, needsOrderBy };
  }

  /**
   * Realiza a busca de usuários elegíveis para convite.
   * - NÃO exclui “já na sala” via Firestore porque não existe “not array-contains”.
   * - Faz o filtro no client com base em roomIds.
   *
   * @param roomId ID da sala para evitar usuários já vinculados
   * @param searchTerm termo opcional (prefix)
   * @param filters filtros adicionais (expansível)
   */
  searchEligibleUsers(
    roomId: string,
    searchTerm: string = '',
    filters: QueryConstraint[] = []
  ): Observable<IUserDados[]> {
    // defer captura throws síncronos (ex.: collectionName vazio, Firestore instance inválida, etc.)
    return defer(() => {
      const { constraints, needsOrderBy } = this.buildQueryConstraints(searchTerm, filters);

      const db = this.firestoreQueryService.getFirestoreInstance();
      const usersRef = collection(db, 'users');

      // Recomendação prática: limitar resultados para não puxar coleção inteira em buscas curtas
      const q = needsOrderBy
        ? query(usersRef, ...constraints, orderBy('nicknameLowerCase'), limit(40))
        : query(usersRef, ...constraints, limit(40));

      this.debugLog('Executando query', {
        roomId,
        searchTerm: searchTerm?.trim() ?? '',
        constraintsCount: constraints.length,
        ordered: needsOrderBy,
      });

      return getDocs(q);
    }).pipe(
      map((snapshot) => {
        const users = snapshot.docs.map((d) => d.data() as IUserDados);

        // Filtra “já na sala” no client
        const eligible = users.filter((u) => !u.roomIds || !u.roomIds.includes(roomId));

        this.debugLog('Usuários elegíveis', { count: eligible.length });
        return eligible;
      }),
      catchError((err) => {
        this.routeError(err, 'searchEligibleUsers', 'Erro ao buscar usuários elegíveis.');
        return of([] as IUserDados[]);
      })
    );
  }

  /**
   * Valida/expande filtros para novos casos.
   * Aqui não dá para usar instanceof(where) (where é função).
   * Estratégia: “best effort” para detectar tipo e evitar filtros nulos.
   */
  validateAndExpandFilters(filters: QueryConstraint[]): QueryConstraint[] {
    const safe = (filters ?? []).filter(Boolean);

    // Detecta “where-like” (não depende de API pública estável)
    const hasWhere = safe.some((f: any) => String(f?.type ?? '').toLowerCase() === 'where');

    this.debugLog('validateAndExpandFilters', { count: safe.length, hasWhere });

    // Aqui você pode adicionar defaults no futuro sem quebrar chamadas existentes.
    return safe;
  }

  /**
   * Centraliza roteamento de erro:
   * - GlobalErrorHandlerService para log/telemetria
   * - ErrorNotificationService para feedback da UI
   */
  private routeError(err: unknown, context: string, userMessage?: string): void {
    const e = err instanceof Error ? err : new Error(`[InviteSearchService] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;

    this.globalError.handleError(e);

    if (userMessage) {
      this.notify.showError(userMessage);
    }
  }
} // Linha 155
