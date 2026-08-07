import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, combineLatest, defer, from, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { isCurrentLegalAcceptanceSatisfied } from './terms-acceptance.service';

interface EnsureCurrentLegalNoticeResponse {
  required: boolean;
  noticeCreated: boolean;
  version: string;
}

@Injectable({ providedIn: 'root' })
export class LegalUpdateNoticeService {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly currentUser = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly ensureNoticeCallable = httpsCallable<
    Record<string, never>,
    EnsureCurrentLegalNoticeResponse
  >(this.functions, 'ensureCurrentLegalNotice');

  /**
   * Observa a conta autenticada e solicita ao backend uma notificação idempotente
   * apenas quando a política do ambiente exige a versão jurídica vigente e ela
   * ainda não foi aceita.
   */
  watchAndEnsure$(): Observable<void> {
    return combineLatest([
      this.session.ready$,
      this.session.uid$,
      this.currentUser.user$,
    ]).pipe(
      filter(([ready, uid, user]) => {
        if (!ready) return false;
        if (!uid) return true;
        return user !== undefined;
      }),
      map(([_, uid, user]) => {
        const ownerUid = String(uid ?? '').trim() || null;
        const ownerUser = ownerUid && user?.uid === ownerUid ? user : null;

        return {
          ownerUid,
          current: isCurrentLegalAcceptanceSatisfied(ownerUser?.acceptedTerms),
        };
      }),
      distinctUntilChanged(
        (previous, current) =>
          previous.ownerUid === current.ownerUid &&
          previous.current === current.current
      ),
      switchMap(({ ownerUid, current }) => {
        if (!ownerUid || current) {
          return of(void 0);
        }

        return defer(() => from(this.ensureNoticeCallable({}))).pipe(
          map(() => void 0),
          catchError((error) => {
            this.report(error, ownerUid);
            return of(void 0);
          })
        );
      })
    );
  }

  private report(error: unknown, ownerUid: string): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error('[LegalUpdateNoticeService] ensure notice failed');
      (reportable as any).context = 'LegalUpdateNoticeService';
      (reportable as any).operation = 'watchAndEnsure';
      (reportable as any).extra = { ownerUid };
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;
      this.globalError.handleError(reportable);
    } catch {
      // A falha de notificação não libera o acesso nem quebra o shell.
    }
  }
}
