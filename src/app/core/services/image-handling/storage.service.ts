// C:\entretenimento\src\app\core\services\image-handling\storage.service.ts
// Serviço de Storage endurecido para alinhar com as storage.rules novas.
//
// Objetivos desta revisão:
// - parar de confiar em path arbitrário vindo de fora
// - alinhar os uploads ao namespace seguro do usuário
// - manter os nomes dos métodos públicos para reduzir impacto no restante do app
// - centralizar validações básicas de arquivo e path
// - usar AngularFire Storage já configurado no AppModule
// - manter tratamento de erro centralizado via GlobalErrorHandlerService
//
// OBSERVAÇÃO IMPORTANTE:
// - A área users/{uid}/uploads/... agora representa upload bruto.
// - Pelas rules atuais, essa área NÃO tem leitura direta.
// - Portanto, quando getDownloadURL() falhar por regra, o upload continua sendo
//   considerado concluído, e o método devolve o storage path para a próxima etapa.
//
// SUPRESSÕES EXPLÍCITAS:
// 1) uploadFile(file, path, userId):
//    - o parâmetro "path" foi mantido apenas por compatibilidade de assinatura
//    - o uso dele como caminho real foi SUPRIMIDO
//    - motivo: impedir gravação arbitrária no bucket
//
// 2) uploadProfileAvatar(...):
//    - o caminho antigo "avatars/{userId}.jpg" foi SUPRIMIDO
//    - motivo: incompatível com as rules novas e fora do namespace do usuário
//
// 3) getStorage():
//    - foi SUPRIMIDO
//    - motivo: o app já fornece Storage no AppModule e conecta o emulador lá
//
// COMPATIBILIDADE TEMPORÁRIA:
// - Alguns métodos ainda devolvem string no campo/fluxo "url" por compatibilidade,
//   mas essa string pode ser:
//   a) uma download URL, quando a leitura for permitida
//   b) um storage path bruto, quando a leitura direta não for permitida
//
// Próxima etapa recomendada:
// - separar "uploads" (bruto) de "published/avatar" e "published/media"
// - publicar apenas mídia aprovada/controlada
import { Injectable, inject } from '@angular/core';
import { Storage } from '@angular/fire/storage';
import { Auth } from '@angular/fire/auth';
import {
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { firstValueFrom, from, Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { ErrorNotificationService } from '../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';
import { Store } from '@ngrx/store';
import {
  uploadSuccess,
  uploadError,
  uploadProgress,
} from '../../../store/actions/actions.user/file.actions';
import { AppState } from 'src/app/store/states/app.state';
import { UsuarioService } from '../user-profile/usuario.service';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(Auth);
  private readonly debug = !environment.production;

  constructor(
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly store: Store<AppState>,
    private readonly usuarioService: UsuarioService
  ) {}

  // ---------------------------------------------------------------------------
  // Debug / erro centralizado
  // ---------------------------------------------------------------------------

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[StorageService] ${message}`, extra ?? '');
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
      // noop
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return (error as { message: string }).message;
    }
    return String(error);
  }

  // ---------------------------------------------------------------------------
  // Helpers de sessão / path / arquivo
  // ---------------------------------------------------------------------------

  private get currentUid(): string | null {
    return this.auth.currentUser?.uid?.trim() || null;
  }

  private sanitizeUid(userId: string): string {
    return (userId ?? '').trim();
  }

  private sanitizeFileName(fileName: string): string {
    const raw = (fileName ?? '').trim().toLowerCase();

    return (
      raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `file-${Date.now()}`
    );
  }

  private guessImageExtension(file: File): string {
    const type = (file?.type ?? '').toLowerCase();

    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/jpg') return 'jpg';

    const name = (file?.name ?? '').toLowerCase();
    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.webp')) return 'webp';
    if (name.endsWith('.gif')) return 'gif';

    return 'jpg';
  }

  private buildImageUploadPath(userId: string, fileName: string): string {
    const safeUid = this.sanitizeUid(userId);
    const safeName = this.sanitizeFileName(fileName);

    return `users/${safeUid}/uploads/images/${safeName}`;
  }

  private buildVideoUploadPath(userId: string, fileName: string): string {
    const safeUid = this.sanitizeUid(userId);
    const safeName = this.sanitizeFileName(fileName);

    return `users/${safeUid}/uploads/videos/${safeName}`;
  }

  private buildAvatarUploadPath(userId: string, file: File): string {
    const safeUid = this.sanitizeUid(userId);
    const ext = this.guessImageExtension(file);

    return `users/${safeUid}/published/avatar/avatar-${Date.now()}.${ext}`;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test((value ?? '').trim());
  }

  private isOwnUploadPath(path: string, uid: string): boolean {
    const clean = (path ?? '').trim();
    if (!clean || !uid) return false;

    const escapedUid = uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `^users/${escapedUid}/uploads/(images|videos)/[^/]+$`,
      'i'
    );

    return re.test(clean);
  }

  private isPublishedReadablePath(path: string): boolean {
    const clean = (path ?? '').trim();
    if (!clean) return false;

    return /^users\/[^/]+\/published\/(avatar|images|videos)\/[^/]+$/i.test(clean);
  }

  private validateMutableOwnedPath(path: string): Observable<string> {
    const cleanPath = (path ?? '').trim();
    const uid = this.currentUid;

    if (!uid) {
      return throwError(() => new Error('Sessão não encontrada para manipular o arquivo.'));
    }

    if (!this.isOwnUploadPath(cleanPath, uid)) {
      return throwError(() => new Error('Path inválido ou não pertence ao usuário autenticado.'));
    }

    return of(cleanPath);
  }

  private validateImageFile(file: File): Observable<void> {
    if (!file) {
      return throwError(() => new Error('Arquivo inválido.'));
    }

    if (!String(file.type || '').startsWith('image/')) {
      return throwError(() => new Error('Apenas imagens são permitidas neste fluxo.'));
    }

    if (file.size > 10 * 1024 * 1024) {
      return throwError(() => new Error('A imagem excede o limite de 10 MB.'));
    }

    return of(void 0);
  }

  private validateVideoFile(file: File): Observable<void> {
    if (!file) {
      return throwError(() => new Error('Arquivo inválido.'));
    }

    if (!String(file.type || '').startsWith('video/')) {
      return throwError(() => new Error('Apenas vídeos são permitidos neste fluxo.'));
    }

    if (file.size > 500 * 1024 * 1024) {
      return throwError(() => new Error('O vídeo excede o limite de 500 MB.'));
    }

    return of(void 0);
  }

  private resolveUploadKind(file: File, requestedPath?: string): 'image' | 'video' {
    const type = String(file?.type || '').toLowerCase();
    const requested = String(requestedPath || '').toLowerCase();

    if (type.startsWith('video/') || requested.includes('/videos/')) {
      return 'video';
    }

    return 'image';
  }

  /**
   * Tenta obter a download URL.
   *
   * Importante:
   * - Em uploads brutos, as rules podem negar leitura direta.
   * - Nesses casos, NÃO tratamos como falha do upload.
   * - Fazemos fallback para o próprio storage path.
   */
  private resolveReadableLocation$(storagePath: string): Observable<string> {
    const storageRef = ref(this.storage, storagePath);

    return from(getDownloadURL(storageRef)).pipe(
      map((url) => url),
      catchError((err) => {
        this.routeError(
          '[StorageService] getDownloadURL bloqueado ou indisponível; usando storage path.',
          err,
          { storagePath },
          false
        );

        return of(storagePath);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Upload genérico
  // ---------------------------------------------------------------------------

  /**
   * uploadFile:
   * - assinatura preservada por compatibilidade
   * - o path externo continua chegando, mas o uso operacional dele foi suprimido
   * - o caminho real é decidido internamente, de forma segura
   *
   * Retorno:
   * - pode devolver download URL (quando legível)
   * - ou storage path bruto (quando a leitura direta não é permitida)
   */
  uploadFile(file: File, path: string, userId: string): Observable<string> {
    const safeUid = this.sanitizeUid(userId);
    if (!safeUid) {
      return throwError(() => new Error('UID inválido para upload.'));
    }

    const currentUid = this.currentUid;
    if (currentUid && currentUid !== safeUid) {
      return throwError(() => new Error('O upload deve ocorrer apenas no namespace do usuário autenticado.'));
    }

    const kind = this.resolveUploadKind(file, path);
    const validation$ = kind === 'video'
      ? this.validateVideoFile(file)
      : this.validateImageFile(file);

    return validation$.pipe(
      switchMap(() => {
        const resolvedPath =
          kind === 'video'
            ? this.buildVideoUploadPath(safeUid, file.name)
            : this.buildImageUploadPath(safeUid, file.name);

        this.dbg('Iniciando uploadFile', {
          fileName: file.name,
          kind,
          requestedPath: path,
          resolvedPath,
          userId: safeUid,
        });

        const storageRef = ref(this.storage, resolvedPath);
        const uploadTask = uploadBytesResumable(storageRef, file);

        return new Observable<string>((observer) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress =
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

              this.dbg('Progresso do upload', { progress, resolvedPath });
              this.store.dispatch(uploadProgress({ progress }));
            },
            (error) => {
              const errorMsg = this.extractErrorMessage(error);

              this.dbg('Erro durante uploadFile', { errorMsg, resolvedPath });
              this.store.dispatch(uploadError({ error: errorMsg }));
              this.routeError(
                '[StorageService] Falha durante uploadFile.',
                error,
                { resolvedPath, fileName: file.name, kind },
                false
              );
              this.errorNotifier.showError(
                kind === 'video' ? 'Erro no upload do vídeo.' : 'Erro no upload da foto.'
              );
              observer.error(error);
            },
            () => {
              this.resolveReadableLocation$(resolvedPath).subscribe({
                next: (location) => {
                  /**
                   * SUPRESSÃO SEMÂNTICA EXPLÍCITA:
                   * - a action se chama uploadSuccess({ url })
                   * - porém, com rules rígidas, este "url" pode carregar storage path bruto
                   * - mantemos esse formato apenas para preservar compatibilidade imediata
                   */
                  this.store.dispatch(uploadSuccess({ url: location }));
                  observer.next(location);
                  observer.complete();
                },
                error: (error) => {
                  const errorMsg = this.extractErrorMessage(error);

                  this.dbg('Erro ao resolver localização legível', {
                    errorMsg,
                    resolvedPath,
                  });

                  this.store.dispatch(uploadError({ error: errorMsg }));
                  observer.error(error);
                },
              });
            }
          );
        });
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('Erro no fluxo uploadFile', { errorMsg, path, userId });
        this.routeError(
          '[StorageService] Erro no fluxo do Observable uploadFile.',
          error,
          { path, userId, fileName: file?.name },
          false
        );

        return throwError(() => error);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Avatar
  // ---------------------------------------------------------------------------

  /**
   * uploadProfileAvatar:
   * - alinha o upload de avatar ao namespace seguro do usuário
   * - tenta obter URL legível
   * - se não houver leitura direta pelas rules atuais, retorna o storage path
   *
   * IMPORTANTE:
   * - a atualização automática de photoURL só ocorre quando a localização obtida
   *   for uma URL HTTP(S) real
   * - se o retorno for storage path bruto, não forçamos atualizar photoURL com
   *   um valor que quebraria as telas que esperam URL
   */
  uploadProfileAvatar(
    file: File,
    userId: string,
    progressCallback?: (progress: number) => void
  ): Observable<string> {
    const safeUid = this.sanitizeUid(userId);
    if (!safeUid) {
      return throwError(() => new Error('UID inválido para upload de avatar.'));
    }

    const currentUid = this.currentUid;
    if (currentUid && currentUid !== safeUid) {
      return throwError(() => new Error('O avatar só pode ser enviado pelo usuário autenticado.'));
    }

    return this.validateImageFile(file).pipe(
      switchMap(() => {
        const avatarPath = this.buildAvatarUploadPath(safeUid, file);

        this.dbg('Iniciando uploadProfileAvatar', {
          userId: safeUid,
          resolvedPath: avatarPath,
        });

        const storageRef = ref(this.storage, avatarPath);
        const uploadTask = uploadBytesResumable(storageRef, file);

        return new Observable<string>((observer) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              if (progressCallback) {
                const progress =
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

                this.dbg('Progresso uploadProfileAvatar', { progress, avatarPath });
                progressCallback(progress);
              }
            },
            (error) => {
              const errorMsg = this.extractErrorMessage(error);

              this.dbg('Erro uploadProfileAvatar', { errorMsg, avatarPath });
              this.routeError(
                '[StorageService] Falha durante uploadProfileAvatar.',
                error,
                { avatarPath, userId: safeUid, fileName: file.name },
                false
              );
              this.errorNotifier.showError('Erro no upload do avatar.');
              observer.error(error);
            },
            () => {
              this.resolveReadableLocation$(avatarPath).subscribe({
                next: async (location) => {
                  try {
                    if (this.isHttpUrl(location)) {
                      await firstValueFrom(
                        this.usuarioService.atualizarUsuario(safeUid, {
                          photoURL: location,
                        })
                      );

                      this.dbg('Avatar atualizado com URL pública/legível', {
                        userId: safeUid,
                        location,
                      });

                      this.errorNotifier.showSuccess('Avatar atualizado com sucesso!');
                    } else {
                      /**
                       * SUPRESSÃO EXPLÍCITA:
                       * - não gravamos photoURL com storage path bruto
                       * - motivo: as telas atuais usam photoURL como src direto
                       * - gravar o path aqui quebraria a renderização e esconderia o problema
                       */
                      this.dbg('Avatar enviado, mas sem URL legível imediata', {
                        userId: safeUid,
                        storagePath: location,
                      });

                      this.errorNotifier.showSuccess(
                        'Avatar enviado com sucesso. A URL pública dependerá da próxima etapa de publicação.'
                      );
                    }

                    observer.next(location);
                    observer.complete();
                  } catch (error) {
                    const errorMsg = this.extractErrorMessage(error);

                    this.dbg('Erro ao atualizar perfil após uploadProfileAvatar', {
                      errorMsg,
                      avatarPath,
                    });

                    this.routeError(
                      '[StorageService] Erro ao atualizar perfil com o novo avatar.',
                      error,
                      { userId: safeUid, avatarPath },
                      false
                    );

                    this.errorNotifier.showError(
                      'Erro ao atualizar o perfil com a nova foto.'
                    );

                    observer.error(error);
                  }
                },
                error: (error) => {
                  const errorMsg = this.extractErrorMessage(error);

                  this.dbg('Erro ao resolver localização do avatar', {
                    errorMsg,
                    avatarPath,
                  });

                  observer.error(error);
                },
              });
            }
          );
        });
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('Erro no fluxo uploadProfileAvatar', {
          errorMsg,
          userId: safeUid,
          fileName: file?.name,
        });

        this.routeError(
          '[StorageService] Erro no fluxo do Observable uploadProfileAvatar.',
          error,
          { userId: safeUid, fileName: file?.name },
          false
        );

        return throwError(() => error);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  /**
   * getPhotoUrl:
   * - se receber uma URL HTTP(S), devolve como está
   * - se receber um path de área publicada, tenta resolver URL
   * - se receber um path bruto do próprio usuário, tenta resolver
   * - qualquer outro path é rejeitado defensivamente
   */
  getPhotoUrl(path: string): Observable<string> {
    const cleanPath = (path ?? '').trim();
    this.dbg('Buscando localização da foto', { path: cleanPath });

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
      this.dbg('getPhotoUrl bloqueado por path desconhecido/não autorizado', {
        path: cleanPath,
      });

      return of('');
    }

    const storageRef = ref(this.storage, cleanPath);

    return from(getDownloadURL(storageRef)).pipe(
      map((url) => {
        this.dbg('URL da foto obtida', { path: cleanPath, url });
        return url;
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('Erro ao carregar a foto', {
          path: cleanPath,
          errorMsg,
        });

        this.routeError(
          '[StorageService] Erro ao carregar foto por path.',
          error,
          { path: cleanPath },
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
   * replaceFile:
   * - continua existindo com o mesmo nome
   * - agora valida se o path pertence ao usuário autenticado
   * - restringe replace para namespace seguro do próprio usuário
   *
   * Retorno:
   * - tenta URL legível
   * - fallback para o próprio storage path
   */
  replaceFile(file: File, path: string): Observable<string> {
    this.dbg('Iniciando replaceFile', { path });

    const kind = this.resolveUploadKind(file, path);
    const validation$ = kind === 'video'
      ? this.validateVideoFile(file)
      : this.validateImageFile(file);

    return this.validateMutableOwnedPath(path).pipe(
      switchMap((safePath) => validation$.pipe(map(() => safePath))),
      switchMap((safePath) => {
        const storageRef = ref(this.storage, safePath);

        return from(uploadBytes(storageRef, file)).pipe(
          switchMap(() => this.resolveReadableLocation$(safePath)),
          map((location) => {
            this.dbg('Arquivo substituído com sucesso', {
              path: safePath,
              location,
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

        this.dbg('Erro ao substituir arquivo', { path, errorMsg });
        this.routeError(
          '[StorageService] Erro ao substituir arquivo.',
          error,
          { path, fileName: file?.name },
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
   * deleteFile:
   * - agora só permite exclusão em path próprio e permitido
   * - evita que callers apaguem caminhos arbitrários
   */
  deleteFile(path: string): Observable<void> {
    this.dbg('Iniciando deleteFile', { path });

    return this.validateMutableOwnedPath(path).pipe(
      switchMap((safePath) => {
        const storageRef = ref(this.storage, safePath);

        return from(deleteObject(storageRef)).pipe(
          map(() => {
            this.dbg('Arquivo deletado com sucesso', { path: safePath });
            this.errorNotifier.showSuccess('Arquivo deletado com sucesso!');
          })
        );
      }),
      catchError((error) => {
        const errorMsg = this.extractErrorMessage(error);

        this.dbg('Erro ao deletar arquivo', { path, errorMsg });
        this.routeError(
          '[StorageService] Erro ao deletar arquivo.',
          error,
          { path },
          false
        );

        this.errorNotifier.showError('Erro ao deletar o arquivo.');
        return of(void 0);
      })
    );
  }
} // Linha 738, gigante