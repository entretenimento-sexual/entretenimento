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
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PhotoFirestoreService } from 'src/app/core/services/image-handling/photo-firestore.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-user-photo-manager',
  templateUrl: './user-photo-manager.component.html',
  styleUrls: ['./user-photo-manager.component.css'],
  standalone: true,
  imports: [CommonModule]
})
export class UserPhotoManagerComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  userPhotos$: Observable<any[]> = of([]);
  userId = '';

  constructor(
    private readonly photoService: PhotoFirestoreService,
    private readonly storageService: StorageService,
    private readonly authSession: AuthSessionService,
    private readonly errorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService,
  ) { }

  ngOnInit(): void {
    this.loadUserPhotos();
  }

  /**
   * Carrega as fotos do usuário autenticado.
   *
   * Estratégia:
   * - UID vem do AuthSessionService (fonte canônica da sessão)
   * - quando não há UID, retorna lista vazia
   * - em erro, não quebra a UI: registra erro e retorna []
   */
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

  /**
   * Exclui uma foto do usuário autenticado.
   * - mantém nomenclatura original
   * - protege contra UID ausente
   * - tratamento de erro centralizado
   */
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

  /**
   * Encaminha erro ao handler global e exibe feedback amigável.
   */
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
} // Linha 154
