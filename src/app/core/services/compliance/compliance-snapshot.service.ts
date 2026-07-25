// src/app/core/services/compliance/compliance-snapshot.service.ts
// -----------------------------------------------------------------------------
// COMPLIANCE SNAPSHOT SERVICE
// -----------------------------------------------------------------------------
//
// Serviço Observable-first para a projeção sanitizada devolvida pelo backend.
// Nenhum documento sensível é lido diretamente do Firestore ou persistido no
// navegador.

import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  Subject,
  defer,
  from,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import {
  ComplianceSnapshot,
  createUnavailableComplianceSnapshot,
  normalizeComplianceSnapshot,
} from 'src/app/core/interfaces/compliance/compliance-snapshot.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class ComplianceSnapshotService {
  private readonly refreshSubject = new Subject<void>();
  private readonly getSnapshotCallable = httpsCallable<
    Record<string, never>,
    unknown
  >(this.functions, 'getMyComplianceSnapshot');

  readonly currentSnapshot$: Observable<ComplianceSnapshot> =
    this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      distinctUntilChanged(),
      switchMap((uid) => {
        if (!uid) {
          return of(createUnavailableComplianceSnapshot());
        }

        return this.refreshSubject.pipe(
          startWith(undefined),
          switchMap(() => this.getMyComplianceSnapshot$())
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor(
    private readonly functions: Functions,
    private readonly session: AuthSessionService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * Consulta a autoridade backend e normaliza o payload de forma fail-closed.
   * Falhas retornam snapshot indisponível para que guards e telas nunca liberem
   * saque por ausência de resposta.
   */
  getMyComplianceSnapshot$(): Observable<ComplianceSnapshot> {
    return defer(() => from(this.getSnapshotCallable({}))).pipe(
      map((result) => normalizeComplianceSnapshot(result.data)),
      catchError((error) => {
        this.reportError(error, 'getMyComplianceSnapshot$');
        return of(createUnavailableComplianceSnapshot());
      })
    );
  }

  refreshCurrentSnapshot(): void {
    this.refreshSubject.next();
  }

  private reportError(error: unknown, operation: string): void {
    try {
      const err =
        error instanceof Error
          ? error
          : new Error('[ComplianceSnapshotService] operation failed');

      (err as any).context = 'ComplianceSnapshotService';
      (err as any).operation = operation;
      (err as any).original = error;
      (err as any).silent = true;
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
