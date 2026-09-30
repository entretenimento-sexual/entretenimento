import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';

@Injectable()
export class VisitedProfileInteractionOrchestrator {
  constructor(
    private readonly authSession: AuthSessionService,
    private readonly friendshipService: FriendshipService,
    private readonly directChatService: DirectChatService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  sendInterest$(
    targetUid: string,
    canSend: boolean,
    blockedMessage: string
  ): Observable<boolean> {
    const safeTargetUid = String(targetUid ?? '').trim();

    if (!safeTargetUid) {
      return of(false);
    }

    return this.authSession.uid$.pipe(
      take(1),
      switchMap((requesterUid) => {
        const safeRequesterUid = String(requesterUid ?? '').trim();

        if (!safeRequesterUid) {
          return throwError(
            () => new Error('Sessão não identificada para demonstrar interesse.')
          );
        }

        if (safeRequesterUid === safeTargetUid) {
          return throwError(
            () => new Error('Você não pode demonstrar interesse no próprio perfil.')
          );
        }

        if (!canSend) {
          return throwError(
            () => new Error(blockedMessage || 'Interesse indisponível.')
          );
        }

        return this.friendshipService
          .sendRequest(
            safeRequesterUid,
            safeTargetUid,
            'Olá! Gostaria de conhecer você.'
          )
          .pipe(
            switchMap(() => of(true))
          );
      }),
      catchError((error) => {
        this.applicationError.report(error, {
          feature: 'profile-view',
          operation: 'VisitedProfileInteractionOrchestrator.sendInterest',
          fallbackMessage: 'Não foi possível enviar o interesse.',
          metadata: {
            scope: 'VisitedProfileInteractionOrchestrator',
            hasTargetUid: true,
          },
        });

        return of(false);
      })
    );
  }

  prepareDirectChat$(targetUid: string): Observable<string | null> {
    const safeTargetUid = String(targetUid ?? '').trim();

    if (!safeTargetUid) {
      return of(null);
    }

    return this.directChatService
      .ensureDirectChatIdWithUser$(safeTargetUid)
      .pipe(
        take(1),
        catchError((error) => {
          this.applicationError.report(error, {
            feature: 'profile-view',
            operation: 'VisitedProfileInteractionOrchestrator.prepareDirectChat',
            fallbackMessage: 'Não foi possível preparar a conversa.',
            metadata: {
              scope: 'VisitedProfileInteractionOrchestrator',
              hasTargetUid: true,
            },
          });

          return of(null);
        })
      );
  }
}
