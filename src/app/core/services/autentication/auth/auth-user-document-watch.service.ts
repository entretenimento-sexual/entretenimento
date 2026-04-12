// src/app/core/services/autentication/auth/auth-user-document-watch.service.ts
// ============================================================
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
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  take,
  tap,
} from 'rxjs/operators';

import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { environment } from 'src/environments/environment';

export type AuthUserDocumentWatchSource = 'doc' | 'deleted-flag';

export type AuthUserDocumentWatchEvent =
  | { type: 'exists'; uid: string; source: 'doc' }
  | { type: 'missing'; uid: string; source: 'doc' }
  | { type: 'deleted'; uid: string; source: AuthUserDocumentWatchSource }
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
  private readonly streams = new Map<string, Observable<AuthUserDocumentWatchEvent>>();

  constructor(
    private readonly db: Firestore,
    private readonly injector: Injector,
    private readonly userQuery: FirestoreUserQueryService,
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthUserDocumentWatch] ${message}`, extra ?? '');
  }

  watch$(uid: string): Observable<AuthUserDocumentWatchEvent> {
    const cleanUid = this.normalizeUid(uid);
    if (!cleanUid) return EMPTY;

    const cached = this.streams.get(cleanUid);
    if (cached) return cached;

    const stream$ = merge(
      this.buildUserDocWatch$(cleanUid),
      this.buildDeletedFlagWatch$(cleanUid)
    ).pipe(
      distinctUntilChanged((a, b) => this.areEventsEquivalent(a, b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.streams.set(cleanUid, stream$);
    return stream$;
  }

  private buildUserDocWatch$(uid: string): Observable<AuthUserDocumentWatchEvent> {
    return defer(() => {
      const ref = runInInjectionContext(this.injector, () =>
        doc(this.db, 'users', uid)
      );

      return runInInjectionContext(this.injector, () => docSnapshots(ref));
    }).pipe(
      map((snapshot) => this.mapSnapshotToEvent(uid, snapshot)),
      distinctUntilChanged((a, b) => this.areEventsEquivalent(a, b)),
      tap((event) => this.dbg('doc event', event)),
      catchError((err) => of(this.mapErrorToEvent(uid, err, 'doc')))
    );
  }

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
      distinctUntilChanged((a, b) => this.areEventsEquivalent(a, b)),
      tap((event) => this.dbg('deleted-flag event', event)),
      catchError((err) => of(this.mapErrorToEvent(uid, err, 'deleted-flag')))
    );
  }

  private mapSnapshotToEvent(
    uid: string,
    snapshot: DocumentSnapshot<DocumentData>
  ): AuthUserDocumentWatchEvent {
    if (!snapshot.exists()) {
      return { type: 'missing', uid, source: 'doc' };
    }

    const data = snapshot.data() ?? {};
    const status = this.normalizeStatus(data);

    if (this.isDeleted(data, status)) {
      return { type: 'deleted', uid, source: 'doc' };
    }

    return { type: 'exists', uid, source: 'doc' };
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

  private areEventsEquivalent(
    a: AuthUserDocumentWatchEvent,
    b: AuthUserDocumentWatchEvent
  ): boolean {
    return (
      a.type === b.type &&
      a.uid === b.uid &&
      a.source === b.source &&
      String((a as any).code ?? '') === String((b as any).code ?? '')
    );
  }

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

  private isDeleted(data: Record<string, unknown>, status: string): boolean {
    return (
      (data as any)?.isDeleted === true ||
      !!(data as any)?.deletedAt ||
      (data as any)?.accountStatus === 'deleted' ||
      status === 'deleted'
    );
  }
} // Linha 213