// src/app/core/services/image-handling/storage.service.ts
// =============================================================================
// StorageService
//
// Serviço de Storage endurecido para a plataforma.
//
// Objetivos:
// - impedir escrita em paths arbitrários;
// - manter uploads brutos privados no namespace do próprio usuário;
// - manter avatar em área publicada/controlada;
// - preparar a base para monetização futura: mídia publicada deve passar por
//   camada própria de publicação/moderação, não sair direto do upload bruto;
// - manter nomes públicos dos métodos para reduzir impacto no restante do app;
// - manter fluxo reativo com Observable;
// - manter tratamento de erro centralizado;
// - manter debug útil em dev sem expor UID bruto, path completo ou nome original.
// =============================================================================

import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
  type UploadMetadata,
  type UploadTask,
} from 'firebase/storage';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { AuthSessionService } from '../autentication/auth/auth-session.service';
import { MediaApplicationErrorService } from '../media/media-application-error.service';
import type { MediaErrorReason } from '../media/media-error.catalog';
import { ErrorNotificationService } from '../error-handler/error-notification.service';
import {
  resolveImageInputFormat,
  resolveVideoInputFormat,
  validateImageMediaFile,
  validateVideoMediaFile,
} from '../media/media-format.policy';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import { FirestoreContextService } from '../data-handling/firestore/core/firestore-context.service';
import { normalizeMediaUploadProgress } from '../media/media-upload-progress.policy';

type UploadKind = 'image' | 'video';
type StorageDebugKind = UploadKind | 'avatar';

interface ReservePhotoUploadCallableRequest {
  ownerUid: string;
  storagePath: string;
  sizeBytes: number;
  contentType: string;
}

interface ReservePhotoUploadCallableResponse {
  reservationId: string;
  expiresAt: number;
}

export interface PhotoUploadAssetResult {
  readonly storagePath: string;
  readonly reservationId: string;
  readonly location: string;
}

/**
 * Adaptador puro para uploads Firebase. Recebe a task já criada, permitindo
 * testar cancelamento real sem inicializar o SDK/Storage no navegador de testes.
 */
export function observeStorageUploadTask$(
  task: Pick<UploadTask, 'on' | 'cancel'>,
  storagePath: string,
  progressCallback?: (progress: number) => void
): Observable<string> {
  return new Observable<string>((observer) => {
    let settled = false;
    const unsubscribe = task.on(
      'state_changed',
      (snapshot) => {
        const progress = snapshot.totalBytes
          ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          : 0;
        progressCallback?.(normalizeMediaUploadProgress(progress));
      },
      (error) => {
        settled = true;
        observer.error(error);
      },
      () => {
        settled = true;
        observer.next(storagePath);
        observer.complete();
      }
    );
    return () => {
      unsubscribe();
      if (!settled) task.cancel();
    };
  });
}

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);
  private readonly authSession = inject(AuthSessionService);
  private readonly functions = inject(Functions);

  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly mediaError: MediaApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly firebaseContext: FirestoreContextService
  ) {}

  /**
   * Mantido por compatibilidade com chamadas antigas.
   *
   * Importante:
   * - este método monta path seguro no namespace do usuário;
   * - o nome original do arquivo não é preservado no path final;
   * - usamos apenas a extensão segura inferida pela política canônica.
   */
  public buildOwnedImageUploadPath(userId: string, fileName: string): string {
    return this.buildImageUploadPath(userId, fileName);
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('storage', `StorageService: ${message}`, extra);
  }

  private routeError(
    operation: string,
    original: unknown,
    meta?: Record<string, unknown>,
    options: {
      notifyUser?: boolean;
      fallbackMessage?: string;
      reasonHint?: MediaErrorReason;
    } = {}
  ): void {
    this.mediaError.report(original, {
      operation,
      fallbackMessage:
        options.fallbackMessage ?? 'Não foi possível concluir a operação de armazenamento.',
      reasonHint: options.reasonHint,
      silent: options.notifyUser !== true,
      metadata: {
        scope: 'StorageService',
        ...(meta ?? {}),
      },
    });
  }

  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    return String(error);
  }

  private getSafeFileDebugMeta(
    file: File | null | undefined,
    kind: UploadKind = 'image'
  ): Record<string, unknown> {
    const type = String(file?.type ?? '').trim().toLowerCase();
    const size = Number(file?.size ?? 0);
    return {
      hasFile: !!file,
      sizeBytes: Number.isFinite(size) ? size : 0,
      type: type || 'unknown',
      extension: file ? this.guessExtension(file, kind) : 'unknown',
    };
  }

  private getSafeStorageDebugMeta(
    kind: StorageDebugKind,
    file?: File | null,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    const mediaKind: UploadKind = kind === 'video' ? 'video' : 'image';
    return {
      kind,
      ...this.getSafeFileDebugMeta(file, mediaKind),
      ...(extra ?? {}),
    };
  }

  private get currentUid(): string | null {
    if (this.authSession.isTerminatingSnapshot) return null;
    return this.auth.currentUser?.uid?.trim() || null;
  }

  /** O UID operacional invalida reservas, uploads e callbacks da sessão anterior. */
  private ownerSessionEnded$(ownerUid: string): Observable<string | null> {
    return this.authSession.uid$.pipe(
      filter((uid) => uid !== ownerUid)
    );
  }

  private sanitizeUid(userId: string): string {
    return String(userId ?? '').trim();
  }

  private isValidUid(uid: string): boolean {
    return /^[A-Za-z0-9_-]{1,128}$/.test(uid);
  }

  private requireAuthenticatedOwnerUid(userId: string): string {
    const safeUid = this.sanitizeUid(userId);
    const currentUid = this.currentUid;

    if (!safeUid || !this.isValidUid(safeUid)) {
      throw new Error('UID inválido para operação de storage.');
    }
    if (!currentUid) {
      throw new Error('Sessão não encontrada para operação de storage.');
    }
    if (currentUid !== safeUid) {
      throw new Error(
        'A operação de storage deve ocorrer apenas no namespace do usuário autenticado.'
      );
    }
    return safeUid;
  }

  private sanitizeFileName(fileName: string): string {
    const raw = String(fileName ?? '').trim().toLowerCase();
    return (
      raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'file'
    );
  }

  private createObjectName(extension: string): string {
    const safeExtension = String(extension || 'bin')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `media-${Date.now()}-${random}.${safeExtension || 'bin'}`;
  }

  private guessExtension(file: File, fallbackKind: UploadKind): string {
    const resolved =
      fallbackKind === 'video'
        ? resolveVideoInputFormat(file)
        : resolveImageInputFormat(file);
    return resolved?.extension ?? (fallbackKind === 'video' ? 'mp4' : 'jpg');
  }

  private resolveImageExtensionFromName(fileName: string): string {
    const normalizedName = this.sanitizeFileName(fileName);
    return (
      resolveImageInputFormat({ name: normalizedName, type: '' })?.extension ??
      'jpg'
    );
  }

  private buildImageUploadPath(userId: string, fileName: string): string {
    const safeUid = this.sanitizeUid(userId);
    if (!this.isValidUid(safeUid)) {
      throw new Error('UID inválido para path de imagem.');
    }
    return `users/${safeUid}/uploads/images/${this.createObjectName(
      this.resolveImageExtensionFromName(fileName)
    )}`;
  }

  private buildVideoUploadPath(userId: string, file: File): string {
    const safeUid = this.sanitizeUid(userId);
    if (!this.isValidUid(safeUid)) {
      throw new Error('UID inválido para path de vídeo.');
    }
    return `users/${safeUid}/uploads/videos/${this.createObjectName(
      this.guessExtension(file, 'video')
    )}`;
  }

  private buildAvatarUploadPath(userId: string, file: File): string {
    const safeUid = this.sanitizeUid(userId);
    if (!this.isValidUid(safeUid)) {
      throw new Error('UID inválido para path de avatar.');
    }
    return `users/${safeUid}/published/avatar/avatar-${Date.now()}.${this.guessExtension(
      file,
      'image'
    )}`;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(String(value ?? '').trim());
  }

  private isOwnUploadPath(path: string, uid: string): boolean {
    const clean = String(path ?? '').trim();
    if (!clean || !uid || !this.isValidUid(uid)) return false;
    const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `^users/${escapedUid}/uploads/(images|videos)/[^/]+$`,
      'i'
    ).test(clean);
  }

  private resolveOwnedUploadPath(
    requestedPath: string,
    uid: string,
    kind: UploadKind,
    file: File
  ): string {
    const cleanPath = String(requestedPath ?? '').trim();

    if (!cleanPath) {
      return kind === 'video'
        ? this.buildVideoUploadPath(uid, file)
        : this.buildImageUploadPath(uid, file.name);
    }

    if (!this.isOwnUploadPath(cleanPath, uid)) {
      throw new Error('Path de upload inválido ou fora do namespace autenticado.');
    }

    const expectedSegment =
      kind === 'video' ? '/uploads/videos/' : '/uploads/images/';

    if (!cleanPath.includes(expectedSegment)) {
      throw new Error('O path de upload não corresponde ao tipo de mídia.');
    }

    return cleanPath;
  }

  private isPublishedReadablePath(path: string): boolean {
    const clean = String(path ?? '').trim();
    if (!clean) return false;
    return /^users\/[^/]+\/published\/(avatar|images|videos)\/[^/]+$/i.test(clean);
  }

  private validateMutableOwnedPath(path: string): Observable<string> {
    const cleanPath = String(path ?? '').trim();
    const uid = this.currentUid;
    if (!uid) {
      return throwError(
        () => new Error('Sessão não encontrada para manipular o arquivo.')
      );
    }
    if (!this.isOwnUploadPath(cleanPath, uid)) {
      return throwError(
        () => new Error('Path inválido ou não pertence ao usuário autenticado.')
      );
    }
    return of(cleanPath);
  }

  private validateImageFile(file: File): Observable<void> {
    return this.validationResult$(validateImageMediaFile(file, 'default'));
  }

  private validateAvatarFile(file: File): Observable<void> {
    return this.validationResult$(validateImageMediaFile(file, 'avatar'));
  }

  private validateVideoFile(file: File): Observable<void> {
    return this.validationResult$(validateVideoMediaFile(file));
  }

  private validationResult$(validation: {
    readonly valid: boolean;
    readonly userMessage?: string;
  }): Observable<void> {
    return validation.valid
      ? of(void 0)
      : throwError(
          () => new Error(validation.userMessage ?? 'Arquivo de mídia inválido.')
        );
  }

  private resolveUploadKind(file: File, requestedPath?: string): UploadKind {
    const requested = String(requestedPath || '').toLowerCase();
    if (resolveVideoInputFormat(file) || requested.includes('/videos/')) {
      return 'video';
    }
    return 'image';
  }

  private uploadResumablePath$(
    storagePath: string,
    file: File,
    kind: StorageDebugKind,
    progressCallback?: (progress: number) => void,
    metadata?: UploadMetadata
  ): Observable<string> {
    const storageRef = ref(this.storage, storagePath);
    const task = uploadBytesResumable(storageRef, file, metadata);
    return observeStorageUploadTask$(task, storagePath, (progress) => {
      this.dbg('upload progress', { kind, progress });
      progressCallback?.(progress);
    });
  }

  private resolveReadableLocation$(storagePath: string): Observable<string> {
    const storageRef = ref(this.storage, storagePath);
    return from(getDownloadURL(storageRef)).pipe(
      catchError(() => {
        this.dbg('readable URL unavailable; using storage path fallback', {
          hasStoragePath: !!storagePath,
        });
        return of(storagePath);
      })
    );
  }

  private reservePhotoUpload$(
    userId: string,
    storagePath: string,
    file: File
  ): Observable<string> {
    const resolvedFormat = resolveImageInputFormat(file);

    if (!resolvedFormat) {
      return throwError(() =>
        new Error('Formato de imagem inválido para reserva de upload.')
      );
    }

    return this.firebaseContext.deferPromise$(() => {
      const callable = httpsCallable<
        ReservePhotoUploadCallableRequest,
        ReservePhotoUploadCallableResponse
      >(this.functions, 'reservePhotoUpload');

      return callable({
        ownerUid: userId,
        storagePath,
        sizeBytes: file.size,
        contentType: resolvedFormat.mimeType,
      });
    }).pipe(
      map((response) => {
        const reservationId = String(
          response.data?.reservationId ?? ''
        ).trim();

        if (!reservationId) {
          throw new Error(
            'A reserva de upload terminou sem um identificador válido.'
          );
        }

        return reservationId;
      })
    );
  }

  private buildUploadMetadata(
    file: File,
    kind: StorageDebugKind,
    reservationId: string | null
  ): UploadMetadata | undefined {
    if (kind === 'video') {
      return undefined;
    }

    const resolvedFormat = resolveImageInputFormat(file);
    if (!resolvedFormat) {
      return undefined;
    }

    return {
      contentType: resolvedFormat.mimeType,
      ...(reservationId
        ? {
            customMetadata: {
              mediaPhotoReservationId: reservationId,
            },
          }
        : {}),
    };
  }

  uploadOwnedPhotoFile(
    file: File,
    path: string,
    userId: string,
    progressCallback?: (progress: number) => void
  ): Observable<PhotoUploadAssetResult> {
    let safeUid = '';

    return defer(() => {
      safeUid = this.requireAuthenticatedOwnerUid(userId);

      return this.validateImageFile(file).pipe(
        switchMap(() => {
          const storagePath = this.resolveOwnedUploadPath(
            path,
            safeUid,
            'image',
            file
          );

          return this.reservePhotoUpload$(
            safeUid,
            storagePath,
            file
          ).pipe(
            switchMap((reservationId) =>
              this.uploadResumablePath$(
                storagePath,
                file,
                'image',
                progressCallback,
                this.buildUploadMetadata(file, 'image', reservationId)
              ).pipe(
                switchMap(() =>
                  this.resolveReadableLocation$(storagePath).pipe(
                    map((location) => ({
                      storagePath,
                      reservationId,
                      location,
                    }))
                  )
                )
              )
            )
          );
        })
      );
    }).pipe(
      takeUntil(this.ownerSessionEnded$(this.sanitizeUid(userId))),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        this.dbg('uploadOwnedPhotoFile failed', {
          errorMsg,
          hasRequestedPath: !!String(path ?? '').trim(),
          hasUserId: !!safeUid,
        });
        this.routeError(
          'uploadOwnedPhotoFile',
          error,
          this.getSafeStorageDebugMeta('image', file, {
            hasRequestedPath: !!String(path ?? '').trim(),
            hasUserId: !!safeUid,
          }),
          {
            notifyUser: true,
            fallbackMessage: 'Não foi possível concluir o upload da foto.',
            reasonHint: 'photo_upload_failed',
          }
        );
        return throwError(() => error);
      })
    );
  }

  uploadFile(
    file: File,
    path: string,
    userId: string,
    progressCallback?: (progress: number) => void
  ): Observable<string> {
    let safeUid = '';
    let kind: UploadKind = 'image';

    return defer(() => {
      safeUid = this.requireAuthenticatedOwnerUid(userId);
      kind = this.resolveUploadKind(file, path);
      const validation$ =
        kind === 'video' ? this.validateVideoFile(file) : this.validateImageFile(file);

      return validation$.pipe(
        switchMap(() => {
          const resolvedPath = this.resolveOwnedUploadPath(
            path,
            safeUid,
            kind,
            file
          );
          this.dbg(
            'uploadFile started',
            this.getSafeStorageDebugMeta(kind, file, {
              hasRequestedPath: !!String(path ?? '').trim(),
              hasResolvedPath: !!resolvedPath,
              sameAuthenticatedUser: true,
            })
          );
          const reservation$ = kind === 'image'
            ? this.reservePhotoUpload$(safeUid, resolvedPath, file)
            : of(null as string | null);

          return reservation$.pipe(
            switchMap((reservationId) =>
              this.uploadResumablePath$(
                resolvedPath,
                file,
                kind,
                progressCallback,
                this.buildUploadMetadata(file, kind, reservationId)
              )
            ),
            switchMap((uploadedPath) => this.resolveReadableLocation$(uploadedPath)),
            map((location) => {
              this.dbg('uploadFile completed', {
                kind,
                hasLocation: !!location,
                readableLocation: this.isHttpUrl(location),
              });
              return location;
            })
          );
        })
      );
    }).pipe(
      takeUntil(this.ownerSessionEnded$(this.sanitizeUid(userId))),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        this.dbg('uploadFile flow failed', {
          kind,
          errorMsg,
          hasRequestedPath: !!String(path ?? '').trim(),
          hasUserId: !!safeUid,
        });
        this.routeError(
          'uploadFile',
          error,
          this.getSafeStorageDebugMeta(kind, file, {
            hasRequestedPath: !!String(path ?? '').trim(),
            hasUserId: !!safeUid,
          }),
          {
            notifyUser: true,
            fallbackMessage:
              kind === 'video'
                ? 'Não foi possível concluir o upload do vídeo.'
                : 'Não foi possível concluir o upload da foto.',
            reasonHint:
              kind === 'video'
                ? 'video_upload_failed'
                : 'photo_upload_failed',
          }
        );
        return throwError(() => error);
      })
    );
  }

  uploadProfileAvatar(
    file: File,
    userId: string,
    progressCallback?: (progress: number) => void
  ): Observable<string> {
    let safeUid = '';

    return defer(() => {
      safeUid = this.requireAuthenticatedOwnerUid(userId);
      return this.validateAvatarFile(file).pipe(
        switchMap(() => {
          const avatarPath = this.buildAvatarUploadPath(safeUid, file);
          this.dbg(
            'uploadProfileAvatar started',
            this.getSafeStorageDebugMeta('avatar', file, {
              hasResolvedPath: !!avatarPath,
              sameAuthenticatedUser: true,
            })
          );
          return this.uploadResumablePath$(
            avatarPath,
            file,
            'avatar',
            progressCallback,
            this.buildUploadMetadata(file, 'avatar', null)
          ).pipe(
            switchMap((uploadedPath) => this.resolveReadableLocation$(uploadedPath)),
            map((location) => {
              this.dbg('uploadProfileAvatar completed', {
                hasUserId: !!safeUid,
                hasLocation: !!location,
                readableLocation: this.isHttpUrl(location),
              });
              return location;
            })
          );
        })
      );
    }).pipe(
      takeUntil(this.ownerSessionEnded$(this.sanitizeUid(userId))),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        this.dbg('uploadProfileAvatar flow failed', {
          errorMsg,
          hasUserId: !!safeUid,
        });
        this.routeError(
          'uploadProfileAvatar',
          error,
          this.getSafeStorageDebugMeta('avatar', file, {
            hasUserId: !!safeUid,
          }),
          {
            notifyUser: true,
            fallbackMessage: 'Não foi possível atualizar a foto do perfil.',
            reasonHint: 'profile_avatar_upload_failed',
          }
        );
        return throwError(() => error);
      })
    );
  }

  getPhotoUrl(path: string): Observable<string> {
    const cleanPath = String(path ?? '').trim();
    this.dbg('getPhotoUrl requested', {
      hasPath: !!cleanPath,
      isHttpUrl: this.isHttpUrl(cleanPath),
    });
    if (!cleanPath) return of('');
    if (this.isHttpUrl(cleanPath)) return of(cleanPath);

    const uid = this.currentUid;
    const canReadKnownPath =
      this.isPublishedReadablePath(cleanPath) ||
      (!!uid && this.isOwnUploadPath(cleanPath, uid));
    if (!canReadKnownPath) {
      this.dbg('getPhotoUrl blocked by unauthorized path', {
        hasPath: !!cleanPath,
      });
      return of('');
    }

    const storageRef = ref(this.storage, cleanPath);
    return from(getDownloadURL(storageRef)).pipe(
      map((url) => {
        this.dbg('getPhotoUrl resolved', {
          hasPath: !!cleanPath,
          hasUrl: !!url,
        });
        return url;
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';

        this.dbg('getPhotoUrl failed', {
          errorMsg,
          code,
          hasPath: !!cleanPath,
        });

        if (code === 'storage/object-not-found') {
          return of('');
        }

        this.routeError(
          'getPhotoUrl',
          error,
          {
            hasPath: !!cleanPath,
            isPublishedPath: this.isPublishedReadablePath(cleanPath),
            isOwnUploadPath: !!uid && this.isOwnUploadPath(cleanPath, uid),
          },
          {
            reasonHint: 'media_access_temporarily_unavailable',
          }
        );
        return of('');
      })
    );
  }

  replaceFile(file: File, path: string): Observable<string> {
    const kind = this.resolveUploadKind(file, path);
    const validation$ =
      kind === 'video' ? this.validateVideoFile(file) : this.validateImageFile(file);

    this.dbg('replaceFile started', {
      kind,
      hasPath: !!String(path ?? '').trim(),
    });

    return this.validateMutableOwnedPath(path).pipe(
      switchMap((safePath) => validation$.pipe(map(() => safePath))),
      switchMap((safePath) => {
        const storageRef = ref(this.storage, safePath);
        const upload$ = kind === 'image'
          ? this.reservePhotoUpload$(
              this.requireAuthenticatedOwnerUid(this.currentUid ?? ''),
              safePath,
              file
            ).pipe(
              switchMap((reservationId) =>
                from(uploadBytes(
                  storageRef,
                  file,
                  this.buildUploadMetadata(file, kind, reservationId)
                ))
              )
            )
          : from(uploadBytes(storageRef, file));

        return upload$.pipe(
          switchMap(() => this.resolveReadableLocation$(safePath)),
          map((location) => {
            this.dbg('replaceFile completed', {
              kind,
              hasPath: !!safePath,
              hasLocation: !!location,
              readableLocation: this.isHttpUrl(location),
            });
            this.errorNotifier.showSuccess(
              kind === 'video'
                ? 'Vídeo substituído com sucesso!'
                : 'Foto substituída com sucesso!'
            );
            return location;
          })
        );
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        this.dbg('replaceFile failed', {
          kind,
          errorMsg,
          hasPath: !!String(path ?? '').trim(),
        });
        this.routeError(
          'replaceFile',
          error,
          { kind, hasPath: !!String(path ?? '').trim() },
          {
            notifyUser: true,
            fallbackMessage:
              kind === 'video'
                ? 'Não foi possível substituir o vídeo.'
                : 'Não foi possível substituir a foto.',
            reasonHint: 'media_replace_failed',
          }
        );
        return of('');
      })
    );
  }

  deleteFile(path: string): Observable<void> {
    this.dbg('deleteFile started', {
      hasPath: !!String(path ?? '').trim(),
    });

    return this.validateMutableOwnedPath(path).pipe(
      switchMap((safePath) => {
        const storageRef = ref(this.storage, safePath);
        return from(deleteObject(storageRef)).pipe(
          map(() => {
            this.dbg('deleteFile completed', { hasPath: !!safePath });
            this.errorNotifier.showSuccess('Arquivo deletado com sucesso.');
          })
        );
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);
        this.dbg('deleteFile failed', {
          errorMsg,
          hasPath: !!String(path ?? '').trim(),
        });
        this.routeError(
          'deleteFile',
          error,
          { hasPath: !!String(path ?? '').trim() },
          {
            notifyUser: true,
            fallbackMessage: 'Não foi possível excluir a mídia.',
            reasonHint: 'media_delete_failed',
          }
        );
        return of(void 0);
      })
    );
  }
}
