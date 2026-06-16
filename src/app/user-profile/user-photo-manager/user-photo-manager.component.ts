// src/app/user-profile/user-photo-manager/user-photo-manager.component.ts
// Componente responsável por listar e excluir as fotos do usuário autenticado.
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica do UID
// - evita subscribe solto no ngOnInit
// - carrega fotos de forma reativa
// - mantém nomenclaturas públicas (loadUserPhotos / deleteFile)
// - centraliza tratamento de erro com GlobalErrorHandlerService + ErrorNotificationService
// - preserva compatibilidade com o template atual
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  Photo,
  PhotoFirestoreService,
} from 'src/app/core/services/image-handling/photo-firestore.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type TPhotoSortMode = 'newest' | 'oldest';

@Component({
  selector: 'app-user-photo-manager',
  templateUrl: './user-photo-manager.component.html',
  styleUrls: ['./user-photo-manager.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class UserPhotoManagerComponent implements OnInit {
  userPhotos$: Observable<Photo[]> = of([]);
  private readonly sortModeSubject = new BehaviorSubject<TPhotoSortMode>('newest');
readonly sortMode$ = this.sortModeSubject.asObservable();
  userId = '';

  constructor(
    private readonly photoService: PhotoFirestoreService,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) {}

  ngOnInit(): void {
    this.loadUserPhotos();
  }

  loadUserPhotos(): void {
    this.userPhotos$ = this.authSession.uid$.pipe(
      map((uid) => (uid ?? '').trim()),
      distinctUntilChanged(),
      tap((uid) => {
        this.userId = uid;
      }),
      switchMap((uid) => {
        if (!uid) {
          return of([]);
        }

        return this.photoService.getPhotosByUser(uid).pipe(
            switchMap((photos) =>
              this.sortMode$.pipe(
                map((mode) => this.sortPhotos(photos, mode))
              )
            ),
            catchError((error) => {
            this.reportError(
              'Erro ao carregar fotos do usuário.',
              error,
              { op: 'loadUserPhotos', uid }
            );
            return of([]);
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  setSortMode(mode: TPhotoSortMode): void {
  this.sortModeSubject.next(mode);
}

getSortModeSnapshot(): TPhotoSortMode {
  return this.sortModeSubject.value;
}

getPhotoDateLabel(photo: Photo): string {
  const createdAt = this.toMillis(photo.createdAt);

  if (!createdAt) {
    return 'data não informada';
  }

  const diffMs = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return 'agora';
  }

  if (minutes < 60) {
    return `há ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `há ${hours} h`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `há ${days} dia${days > 1 ? 's' : ''}`;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(createdAt));
}

private sortPhotos(photos: readonly Photo[], mode: TPhotoSortMode): Photo[] {
  return [...photos].sort((a, b) => {
    const aCreatedAt = this.toMillis(a.createdAt);
    const bCreatedAt = this.toMillis(b.createdAt);

    return mode === 'oldest'
      ? aCreatedAt - bCreatedAt
      : bCreatedAt - aCreatedAt;
  });
}

private toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const maybeTimestamp = value as { toMillis?: () => number } | null | undefined;

  if (typeof maybeTimestamp?.toMillis === 'function') {
    return maybeTimestamp.toMillis();
  }

  return 0;
}

  deleteFile(photoId: string, photoPath: string): void {
    const uid = (this.userId ?? '').trim();

    if (!uid) {
      this.errorNotifier.showWarning('Usuário não autenticado para excluir a foto.');
      return;
    }

    if (!photoId?.trim() || !photoPath?.trim()) {
      this.errorNotifier.showWarning('Dados da foto inválidos para exclusão.');
      return;
    }

    if (!confirm('Tem certeza que deseja excluir esta foto?')) {
      return;
    }

    this.photoService
      .deletePhoto(uid, photoId, photoPath)
      .catch((error) => {
        this.reportError(
          'Erro ao excluir foto.',
          error,
          { op: 'deleteFile', uid, photoId, photoPath }
        );
      });
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'UserPhotoManagerComponent',
        ...(context ?? {})
      };
      (err as any).skipUserNotification = true;
      this.errorHandler.handleError(err);
    } catch {
      // noop
    }
  }
} // Linha 132
