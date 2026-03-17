// src/app/core/services/autentication/auth/auth-user-document-watch.service.ts
// =================================================================
// AUTH USER DOCUMENT WATCH SERVICE
//
// Responsabilidade única:
// - Observar o documento users/{uid} do usuário autenticado
// - Traduzir mudanças do documento em eventos de domínio simples
// - Não decide navegação
// - Não faz signOut
// - Não bloqueia app
//
// Objetivo:
// - Tirar do AuthOrchestratorService a responsabilidade de abrir/manter
//   listeners diretos do documento do usuário
// - Deixar o orchestrator apenas reagindo aos eventos emitidos aqui
//
// Observação arquitetural:
// - Este service não substitui o fluxo oficial de hidratação do perfil
//   (AuthSessionSyncEffects + UserEffects + CurrentUserStoreService).
// - Aqui a preocupação é apenas vigiar o documento do usuário para cenários
//   defensivos: ausente, suspenso, deletado, forbidden etc.
//
// Padrão:
// - Retorna Observable de eventos
// - Não faz side-effects de autenticação diretamente
// - Erros são convertidos em eventos para o orquestrador decidir
// =================================================================
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { Firestore, doc, docSnapshots } from '@angular/fire/firestore';

import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';

import { EMPTY, Observable, defer, merge, of } from 'rxjs';
import { catchError, filter, map, shareReplay, take, tap } from 'rxjs/operators';

import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { environment } from 'src/environments/environment';

export type AuthUserDocumentWatchSource = 'doc' | 'deleted-flag';

export type AuthUserDocumentWatchEvent =
  | {
      type: 'exists';
      uid: string;
      source: 'doc';
    }
  | {
      type: 'missing';
      uid: string;
      source: 'doc';
    }
  | {
      type: 'suspended';
      uid: string;
      source: 'doc';
    }
  | {
      type: 'deleted';
      uid: string;
      source: AuthUserDocumentWatchSource;
    }
  | {
      type: 'forbidden';
      uid: string;
      source: AuthUserDocumentWatchSource;
      code: string;
      error: unknown;
    }
  | {
      type: 'error';
      uid: string;
      source: AuthUserDocumentWatchSource;
      code?: string;
      error: unknown;
    };

@Injectable({ providedIn: 'root' })
export class AuthUserDocumentWatchService {
  private readonly debug = !environment.production;

  constructor(
    private readonly db: Firestore,
    private readonly injector: Injector,
    private readonly userQuery: FirestoreUserQueryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthUserDocumentWatch] ${message}`, extra ?? '');
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Observa o documento users/{uid} e traduz tudo para eventos simples.
   *
   * Eventos possíveis:
   * - exists: doc existe e não indica suspensão/deleção
   * - missing: doc não existe
   * - suspended: doc existe, mas indica conta suspensa/bloqueada
   * - deleted: doc indica exclusão lógica OU watcher dedicado confirmou exclusão
   * - forbidden: permission-denied ao observar
   * - error: qualquer outro erro
   */
  watch$(uid: string): Observable<AuthUserDocumentWatchEvent> {
    const cleanUid = this.normalizeUid(uid);
    if (!cleanUid) return EMPTY;

    return merge(
      this.buildUserDocWatch$(cleanUid),
      this.buildDeletedFlagWatch$(cleanUid)
    ).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  // ---------------------------------------------------------------------------
  // Streams internas
  // ---------------------------------------------------------------------------

  private buildUserDocWatch$(uid: string): Observable<AuthUserDocumentWatchEvent> {
    return defer(() => {
      const ref = runInInjectionContext(this.injector, () =>
        doc(this.db, 'users', uid)
      );

      return runInInjectionContext(this.injector, () => docSnapshots(ref));
    }).pipe(
      map((snapshot) => this.mapSnapshotToEvent(uid, snapshot)),
      tap((event) => this.dbg('doc event', event)),
      catchError((err) => of(this.mapErrorToEvent(uid, err, 'doc')))
    );
  }

  /**
   * Watch dedicado de exclusão.
   * Mantemos separado porque parte da codebase já usa esse caminho especializado.
   */
  private buildDeletedFlagWatch$(uid: string): Observable<AuthUserDocumentWatchEvent> {
    return this.userQuery.watchUserDocDeleted$(uid).pipe(
      filter((deleted) => deleted === true),
      take(1),
      map(
        (): AuthUserDocumentWatchEvent => ({
          type: 'deleted',
          uid,
          source: 'deleted-flag',
        })
      ),
      tap((event) => this.dbg('deleted-flag event', event)),
      catchError((err) => of(this.mapErrorToEvent(uid, err, 'deleted-flag')))
    );
  }

  // ---------------------------------------------------------------------------
  // Mapeamento
  // ---------------------------------------------------------------------------

  private mapSnapshotToEvent(
    uid: string,
    snapshot: DocumentSnapshot<DocumentData>
  ): AuthUserDocumentWatchEvent {
    if (!snapshot.exists()) {
      return {
        type: 'missing',
        uid,
        source: 'doc',
      };
    }

    const data = snapshot.data() ?? {};
    const status = this.normalizeStatus(data);

    if (this.isSuspended(data, status)) {
      return {
        type: 'suspended',
        uid,
        source: 'doc',
      };
    }

    if (this.isDeleted(data, status)) {
      return {
        type: 'deleted',
        uid,
        source: 'doc',
      };
    }

    return {
      type: 'exists',
      uid,
      source: 'doc',
    };
  }

  private mapErrorToEvent(
    uid: string,
    err: unknown,
    source: AuthUserDocumentWatchSource
  ): AuthUserDocumentWatchEvent {
    const code = String((err as any)?.code || '');

    if (code === 'permission-denied') {
      return {
        type: 'forbidden',
        uid,
        source,
        code,
        error: err,
      };
    }

    return {
      type: 'error',
      uid,
      source,
      code: code || undefined,
      error: err,
    };
  }

  // ---------------------------------------------------------------------------
  // Regras de leitura
  // ---------------------------------------------------------------------------

  private normalizeUid(uid: string | null | undefined): string {
    return (uid ?? '').trim();
  }

  private normalizeStatus(data: Record<string, unknown>): string {
    return String(
      (data as any)?.status ??
      (data as any)?.moderation?.status ??
      ''
    )
      .trim()
      .toLowerCase();
  }

private isSuspended(data: Record<string, unknown>, status: string): boolean {
  return (
    (data as any)?.isSuspended === true ||
    (data as any)?.isBanned === true ||
    (data as any)?.accountLocked === true ||
    (data as any)?.accountStatus === 'locked' ||
    status === 'suspended' ||
    status === 'banned' ||
    status === 'locked'
  );
}

  private isDeleted(data: Record<string, unknown>, status: string): boolean {
    return (
      (data as any)?.isDeleted === true ||
      !!(data as any)?.deletedAt ||
      status === 'deleted'
    );
  }
}
