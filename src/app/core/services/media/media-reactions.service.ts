// src/app/core/services/media/media-reactions.service.ts
// MVP de reações (like/unlike). No futuro: Firestore + regras de policy (bloqueio, idade, etc).

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable({ providedIn: 'root' })
export class MediaReactionsService {
  constructor(private readonly errorNotifier: ErrorNotificationService) { }

  toggleLikePhoto$(photoId: string): Observable<void> {
    // MVP: no-op
    if (!photoId) return of(void 0);

    return of(void 0).pipe(
      catchError((err) => {
        this.errorNotifier.showError(err);
        return of(void 0);
      })
    );
  }
}
