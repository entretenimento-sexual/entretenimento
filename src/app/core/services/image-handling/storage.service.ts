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
//
// Observação estrutural:
// - users/{uid}/uploads/... representa mídia bruta/privada.
// - users/{uid}/published/... representa mídia que pode ser lida conforme rules.
// - Fotos/vídeos públicos ou premium devem ser promovidos por fluxo próprio,
//   preferencialmente Cloud Function ou service específico de publicação.
// =============================================================================

import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  Observable,
  defer,
  from,
  of,
  throwError,
} from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { AppState } from 'src/app/store/states/app.state';
import {
  uploadError,
  uploadProgress,
  uploadSuccess,
} from '../../../store/actions/actions.user/file.actions';

import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';

type UploadKind = 'image' | 'video';
type StorageDebugKind = UploadKind | 'avatar';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);

  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly store: Store<AppState>,
    private readonly privacyDebug: PrivacyDebugLoggerService
  ) {}

  /**
   * Mantido por compatibilidade com chamadas antigas.
   *
   * Importante:
   * - este método monta path seguro no namespace do usuário;
   * - o nome original do arquivo não é preservado no path final;
   * - usamos apenas a extensão segura inferida.
   */
  public buildOwnedImageUploadPath(userId: string, fileName: string): string {
    return this.buildImageUploadPath(userId, fileName);
  }

  // ---------------------------------------------------------------------------
  // Debug e erro centralizado
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('storage', `StorageService: ${message}`, extra);
  }

  private routeError(
    message: string,
    original: unknown,
    meta?: Record<string, unknown>,
    notifyUser = false
  ): void {
    try {
      const error = new Error(message);

      (error as any).original = original;
      (error as any).meta = meta;
      (error as any).silent = notifyUser === false;
      (error as any).skipUserNotification = notifyUser === false;

      this.globalErrorHandler.handleError(error);
    } catch {
      // Evita que o tratamento de erro quebre o fluxo principal.
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String((error as { message: unknown }).message);
    }

    return String(error);
  }

  private getSafeFileDebugMeta(
    file: File | null | undefined
  ): Record<string, unknown> {
    const type = String(file?.type ?? '').trim().toLowerCase();
    const size = Number(file?.size ?? 0);

    return {
      hasFile: !!file,
      sizeBytes: Number.isFinite(size) ? size : 0,
      type: type || 'unknown',
      extension: file ? this.guessExtension(file, 'image') : 'unknown',
    };
  }

  private getSafeStorageDebugMeta(
    kind: StorageDebugKind,
    file?: File | null,
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      kind,
      ...this.getSafeFileDebugMeta(file),
      ...(extra ?? {}),
    };
  }

  private normalizeProgress(progress: number): number {
    if (!Number.isFinite(progress)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  // ---------------------------------------------------------------------------
  // Sessão, UID e paths
  // ---------------------------------------------------------------------------

  private get currentUid(): string | null {
    return this.auth.currentUser?.uid?.trim() || null;
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
    const type = String(file?.type ?? '').toLowerCase();
    const name = this.sanitizeFileName(file?.name ?? '');

    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpg';

    if (type === 'video/webm') return 'webm';
    if (type === 'video/quicktime') return 'mov';
    if (type === 'video/mp4') return 'mp4';

    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.webp')) return 'webp';
    if (name.endsWith('.jpeg') || name.endsWith('.jpg')) return 'jpg';
    if (name.endsWith('.webm')) return 'webm';
    if (name.endsWith('.mov')) return 'mov';
    if (name.endsWith('.mp4')) return 'mp4';

    return fallbackKind === 'video' ? 'mp4' : 'jpg';
  }

  private buildImageUploadPath(userId: string, fileName: string): string {
    const safeUid = this.sanitizeUid(userId);

    if (!this.isValidUid(safeUid)) {
      throw new Error('UID inválido para path de imagem.');
    }

    const extensionFromName = this.guessExtension(
      new File([], this.sanitizeFileName(fileName), { type: 'image/jpeg' }),
      'image'
    );

    return `users/${safeUid}/uploads/images/${this.createObjectName(
      extensionFromName
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

    if (!clean || !uid || !this.isValidUid(uid)) {
      return false;
    }

    const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(
      `^users/${escapedUid}/uploads/(images|videos)/[^/]+$`,
      'i'
    ).test(clean);
  }

  private isPublishedReadablePath(path: string): boolean {
    const clean = String(path ?? '').trim();

    if (!clean) {
      return false;
    }

    return /^users\/[^/]+\/published\/(avatar|images|videos)\/[^/]+$/i.test(
      clean
    );
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

  // ---------------------------------------------------------------------------
  // Validação de arquivos
  // ---------------------------------------------------------------------------

  private validateImageFile(file: File): Observable<void> {
    if (!file) {
      return throwError(() => new Error('Arquivo inválido.'));
    }

    const type = String(file.type || '').toLowerCase();

    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      return throwError(
        () => new Error('Apenas imagens JPG, PNG ou WEBP são permitidas.')
      );
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return throwError(
        () => new Error('A imagem excede o limite de 10 MB.')
      );
    }

    return of(void 0);
  }

  private validateAvatarFile(file: File): Observable<void> {
    if (!file) {
      return throwError(() => new Error('Arquivo inválido.'));
    }

    const type = String(file.type || '').toLowerCase();

    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      return throwError(
        () => new Error('O avatar deve ser JPG, PNG ou WEBP.')
      );
    }

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      return throwError(
        () => new Error('O avatar excede o limite de 8 MB.')
      );
    }

    return of(void 0);
  }

  private validateVideoFile(file: File): Observable<void> {
    if (!file) {
      return throwError(() => new Error('Arquivo inválido.'));
    }

    const type = String(file.type || '').toLowerCase();

    if (!ALLOWED_VIDEO_TYPES.has(type)) {
      return throwError(
        () => new Error('Apenas vídeos MP4, WEBM ou MOV são permitidos.')
      );
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      return throwError(
        () => new Error('O vídeo excede o limite de 500 MB.')
      );
    }

    return of(void 0);
  }

  private resolveUploadKind(file: File, requestedPath?: string): UploadKind {
    const type = String(file?.type || '').toLowerCase();
    const requested = String(requestedPath || '').toLowerCase();

    if (type.startsWith('video/') || requested.includes('/videos/')) {
      return 'video';
    }

    return 'image';
  }

  // ---------------------------------------------------------------------------
  // Upload baixo nível
  // ---------------------------------------------------------------------------

  private uploadResumablePath$(
    storagePath: string,
    file: File,
    kind: StorageDebugKind,
    progressCallback?: (progress: number) => void,
    dispatchStoreProgress = false
  ): Observable<string> {
    return new Observable<string>((observer) => {
      const storageRef = ref(this.storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      const unsubscribe = uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = snapshot.totalBytes
            ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            : 0;

          const normalizedProgress = this.normalizeProgress(progress);

          this.dbg('upload progress', {
            kind,
            progress: normalizedProgress,
          });

          if (dispatchStoreProgress) {
            this.store.dispatch(uploadProgress({ progress }));
          }

          progressCallback?.(progress);
        },
        (error) => {
          const errorMsg = this.extractErrorMessage(error);

          this.dbg('upload failed', {
            kind,
            errorMsg,
          });

          if (dispatchStoreProgress) {
            this.store.dispatch(uploadError({ error: errorMsg }));
          }

          observer.error(error);
        },
        () => {
          observer.next(storagePath);
          observer.complete();
        }
      );

      return () => unsubscribe();
    });
  }

  /**
   * Tenta obter uma URL legível.
   *
   * Se as rules negarem leitura direta em upload bruto, não tratamos isso como
   * falha do upload. Retornamos o storage path para a próxima etapa.
   */
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

  // ---------------------------------------------------------------------------
  // Upload genérico
  // ---------------------------------------------------------------------------

  /**
   * uploadFile:
   * - mantém a assinatura antiga;
   * - não usa o path externo como destino real;
   * - decide internamente o namespace seguro;
   * - retorna download URL quando legível, ou storage path bruto quando privado.
   */
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
          const resolvedPath =
            kind === 'video'
              ? this.buildVideoUploadPath(safeUid, file)
              : this.buildImageUploadPath(safeUid, file.name);

          this.dbg(
            'uploadFile started',
            this.getSafeStorageDebugMeta(kind, file, {
              hasRequestedPath: !!String(path ?? '').trim(),
              hasResolvedPath: !!resolvedPath,
              sameAuthenticatedUser: true,
            })
          );

          return this.uploadResumablePath$(
            resolvedPath,
            file,
            kind,
            progressCallback,
            true
          ).pipe(
            switchMap((uploadedPath) => this.resolveReadableLocation$(uploadedPath)),
            map((location) => {
              this.store.dispatch(uploadSuccess({ url: location }));

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
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('uploadFile flow failed', {
          kind,
          errorMsg,
          hasRequestedPath: !!String(path ?? '').trim(),
          hasUserId: !!safeUid,
        });

        this.store.dispatch(uploadError({ error: errorMsg }));

        this.routeError(
          '[StorageService] Erro no fluxo de uploadFile.',
          error,
          this.getSafeStorageDebugMeta(kind, file, {
            hasRequestedPath: !!String(path ?? '').trim(),
            hasUserId: !!safeUid,
          }),
          false
        );

        this.errorNotifier.showError(
          kind === 'video' ? 'Erro no upload do vídeo.' : 'Erro no upload da foto.'
        );

        return throwError(() => error);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Avatar
  // ---------------------------------------------------------------------------

  /**
   * Avatar é publicado em namespace próprio.
   *
   * Este método apenas valida, envia para Storage e devolve URL/path.
   * Persistência em users/{uid} e sincronização pública pertencem ao fluxo de perfil.
   */
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
            false
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
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('uploadProfileAvatar flow failed', {
          errorMsg,
          hasUserId: !!safeUid,
        });

        this.routeError(
          '[StorageService] Erro no fluxo de uploadProfileAvatar.',
          error,
          this.getSafeStorageDebugMeta('avatar', file, {
            hasUserId: !!safeUid,
          }),
          false
        );

        this.errorNotifier.showError('Erro no upload do avatar.');

        return throwError(() => error);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  /**
   * getPhotoUrl:
   * - URL HTTP(S): devolve como está;
   * - published path: tenta resolver;
   * - own upload path: tenta resolver;
   * - qualquer outro path: bloqueia defensivamente.
   */
  getPhotoUrl(path: string): Observable<string> {
    const cleanPath = String(path ?? '').trim();

    this.dbg('getPhotoUrl requested', {
      hasPath: !!cleanPath,
      isHttpUrl: this.isHttpUrl(cleanPath),
    });

    if (!cleanPath) {
      return of('');
    }

    if (this.isHttpUrl(cleanPath)) {
      return of(cleanPath);
    }

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

        this.dbg('getPhotoUrl failed', {
          errorMsg,
          hasPath: !!cleanPath,
        });

        this.routeError(
          '[StorageService] Erro ao carregar foto por path.',
          error,
          {
            hasPath: !!cleanPath,
            isPublishedPath: this.isPublishedReadablePath(cleanPath),
            isOwnUploadPath: !!uid && this.isOwnUploadPath(cleanPath, uid),
          },
          false
        );

        return of('');
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Replace
  // ---------------------------------------------------------------------------

  /**
   * Substituição restrita a upload bruto do próprio usuário.
   *
   * Publicações finais devem ter fluxo próprio.
   */
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

        return from(uploadBytes(storageRef, file)).pipe(
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
          '[StorageService] Erro ao substituir arquivo.',
          error,
          {
            kind,
            hasPath: !!String(path ?? '').trim(),
          },
          false
        );

        this.errorNotifier.showError(
          kind === 'video'
            ? 'Erro ao substituir o vídeo.'
            : 'Erro ao substituir a foto.'
        );

        return of('');
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Exclusão restrita a upload bruto do próprio usuário.
   *
   * Exclusão de conteúdo publicado/moderado deve passar por fluxo específico.
   */
  deleteFile(path: string): Observable<void> {
    this.dbg('deleteFile started', {
      hasPath: !!String(path ?? '').trim(),
    });

    return this.validateMutableOwnedPath(path).pipe(
      switchMap((safePath) => {
        const storageRef = ref(this.storage, safePath);

        return from(deleteObject(storageRef)).pipe(
          map(() => {
            this.dbg('deleteFile completed', {
              hasPath: !!safePath,
            });

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
          '[StorageService] Erro ao deletar arquivo.',
          error,
          {
            hasPath: !!String(path ?? '').trim(),
          },
          false
        );

        this.errorNotifier.showError('Erro ao deletar o arquivo.');
        return of(void 0);
      })
    );
  }
}
