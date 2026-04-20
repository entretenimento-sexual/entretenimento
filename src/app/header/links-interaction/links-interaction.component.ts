// src/app/header/links-interaction/links-interaction.component.ts
// Componente para interação com links no cabeçalho.
//
// Padrão adotado:
// - Este componente governa start/stop dos listeners do header.
// - A decisão de gate NÃO é recalculada localmente.
// - A fonte única de verdade é o AccessControlService.
//
// Observações:
// - Observable-first.
// - Mantém nomenclaturas públicas usadas no template.
// - Erros centralizados em GlobalErrorHandlerService + ErrorNotificationService.
// ============================================================================
// ATENÇÃO — NÃO ACOPLAR ESTE COMPONENTE AO EDITOR DE IMAGENS
// ----------------------------------------------------------------------------
// O editor de imagens atual apresenta histórico de erro residual no runtime.
// Por isso, este componente não deve manter dependência estrutural, import
// estático ou inicialização antecipada do editor terceirizado.
//
// DIRETRIZ:
// - qualquer uso de editor deve ser tardio e explicitamente acionado
// - evitar importar diretamente o componente de edição no topo do arquivo
// - priorizar lazy loading / import dinâmico quando estritamente necessário
// ============================================================================
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { environment } from 'src/environments/environment';

import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

import { SidebarService } from 'src/app/core/services/navigation/sidebar.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ChatNotificationService } from 'src/app/core/services/batepapo/chat-notification.service';

import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { selectInboundRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { selectInboundRequestsRichVM } from 'src/app/store/selectors/selectors.interactions/friends';

import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import * as RT from 'src/app/store/actions/actions.interactions/friends/friends-realtime.actions';

@Component({
  selector: 'app-links-interaction',
  templateUrl: './links-interaction.component.html',
  styleUrls: ['./links-interaction.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LinksInteractionComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  private readonly store = inject(Store<AppState>);
  private readonly modalService = inject(NgbModal);
  private readonly notificationService = inject(ChatNotificationService);
  private readonly sidebarService = inject(SidebarService);

  private readonly authSession = inject(AuthSessionService);
  private readonly accessControl = inject(AccessControlService);

  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  // ===========================================================================
  // UI
  // ===========================================================================

  readonly sidebarOpen$ = this.sidebarService.isSidebarVisible$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ===========================================================================
  // Auth / Gate
  // ===========================================================================

  /**
   * UID canônico para template e governança.
   */
  private readonly authUid$ = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Exposto ao template.
   */
  readonly userId$: Observable<string | null> = this.authUid$;

  /**
   * Mantém compat visual atual:
   * - se houver uid, mostra os links.
   *
   * Se depois você quiser esconder o bloco inteiro durante /register,
   * a mudança deve ser feita aqui, e não no gate de listeners.
   */
  readonly isLogged$: Observable<boolean> = this.authUid$.pipe(
    map((uid) => !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Fonte única para governança de realtime:
   * - usa o gate centralizado do AccessControlService
   * - evita race no boot
   * - evita divergência entre componente e arquitetura
   */
  private readonly realtimeUid$ = combineLatest([
    this.authUid$,
    this.accessControl.canListenRealtime$,
  ]).pipe(
    map(([uid, can]) => (uid && can ? uid : null)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * UID atualmente ativo nos listeners do header.
   * Serve para transições idempotentes de stop/start.
   */
  private activeUid: string | null = null;

  // ===========================================================================
  // Store selectors (template)
  // ===========================================================================

  readonly pendingFriendReqCount$ = this.store.select(selectInboundRequestsCount);
  readonly unreadMessagesCount$ = this.notificationService.unreadMessagesCount$;
  readonly pendingInvitesCount$ = this.notificationService.pendingInvitesCount$;
  readonly inboundRequestsVM$ = this.store.select(selectInboundRequestsRichVM);

  // ===========================================================================
  // Debug
  // ===========================================================================

  private dbg(...args: unknown[]): void {
    if (!environment.production) {
      // eslint-disable-next-line no-console
      console.log('[LinksInteraction]', ...args);
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  ngOnInit(): void {
    /**
     * Governança central de listeners do header.
     */
    this.realtimeUid$
      .pipe(
        tap((uid) => this.applyRealtimeGate(uid)),
        catchError((err) => {
          this.handleError(err, 'Falha ao governar listeners do header.');
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    /**
     * Log de diagnóstico alinhado à fonte central.
     */
    combineLatest([
      this.authUid$,
      this.accessControl.ready$,
      this.accessControl.inRegistrationFlow$,
      this.accessControl.canListenRealtime$,
      this.accessControl.currentUrl$,
    ])
      .pipe(
        auditTime(250),
        tap(([uid, ready, inReg, can, url]) =>
          this.dbg('gate', { uid, ready, inReg, can, url })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.safeStopAll('destroy');
  }

  // ===========================================================================
  // Gate apply (start/stop central)
  // ===========================================================================

  /**
   * Aplica transição do gate com idempotência.
   * - uid === null -> stop
   * - uid !== null -> start
   */
  private applyRealtimeGate(uid: string | null): void {
    if (!uid) {
      if (this.activeUid) {
        this.dbg('gate-off -> stopping (activeUid existed)', this.activeUid);
      }

      this.activeUid = null;
      this.safeStopAll('gate-off');
      return;
    }

    if (this.activeUid && this.activeUid !== uid) {
      this.dbg('uid-change -> stopping previous', { from: this.activeUid, to: uid });
      this.safeStopAll('uid-change');
    }

    if (this.activeUid === uid) {
      return;
    }

    this.activeUid = uid;
    this.dbg('gate-on -> starting realtime', { uid });

    this.safeStartAll(uid);
  }

  private safeStartAll(uid: string): void {
    try {
      this.notificationService.monitorUnreadMessages(uid);
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar monitoramento de mensagens.');
    }

    try {
      this.store.dispatch(A.loadInboundRequests({ uid }));
      this.store.dispatch(A.loadOutboundRequests({ uid }));

      this.store.dispatch(RT.startInboundRequestsListener({ uid }));
      this.store.dispatch(RT.startOutboundRequestsListener({ uid }));
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar listeners de solicitações.');
    }
  }

  private safeStopAll(reason: string): void {
    try {
      this.notificationService.stopUnreadMessagesMonitoring(reason);
    } catch (err) {
      this.handleError(err, 'Falha ao parar monitoramento de mensagens.');
    }

    try {
      this.store.dispatch(RT.stopInboundRequestsListener());
      this.store.dispatch(RT.stopOutboundRequestsListener());
    } catch (err) {
      this.handleError(err, 'Falha ao parar listeners de solicitações.');
    }
  }

  // ===========================================================================
  // Mini-menu actions
  // ===========================================================================

  /**
   * Ao abrir o menu, recarrega inbound se o gate estiver aberto.
   */
  async refreshInboundOnOpen(): Promise<void> {
    const uid = await this.getRealtimeUidOnce();
    if (!uid) return;

    this.store.dispatch(A.loadInboundRequests({ uid }));
  }

  async accept(req: { id: string; requesterUid: string; targetUid?: string }): Promise<void> {
    const me = await this.getRealtimeUidOnce();
    if (!me) return;

    this.store.dispatch(
      A.acceptFriendRequest({
        requestId: req.id,
        requesterUid: req.requesterUid,
        targetUid: me,
      })
    );
  }

  decline(req: { id: string }): void {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  async block(req: { id: string; requesterUid: string }): Promise<void> {
    const me = await this.getRealtimeUidOnce();
    if (!me) return;

    this.store.dispatch(A.blockUser({ ownerUid: me, targetUid: req.requesterUid }));
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  /**
   * Obtém uma vez o UID já validado pelo gate.
   */
  private async getRealtimeUidOnce(): Promise<string | null> {
    try {
      const uid = await firstValueFrom(this.realtimeUid$.pipe(take(1)));
      return uid ?? null;
    } catch (err) {
      this.handleError(err, 'Falha ao obter UID para ação.');
      return null;
    }
  }

  // ===========================================================================
  // Upload / Editor
  // ===========================================================================

  onUploadPhotoClick(): void {
    try {
      const modalRef = this.modalService.open(UploadPhotoComponent, { size: 'lg' });

      modalRef.componentInstance.photoSelected
        .pipe(take(1))
        .subscribe({
          next: (file: File) => this.openPhotoEditorWithFile(file),
          error: (err: unknown) => this.handleError(err, 'Falha ao selecionar foto.'),
        });
    } catch (err) {
      this.handleError(err, 'Falha ao abrir modal de upload.');
    }
  }

  openPhotoEditorWithFile(file: File): void {
    try {
      const editorModalRef = this.modalService.open(PhotoEditorComponent, { size: 'lg' });
      editorModalRef.componentInstance.imageFile = file;
    } catch (err) {
      this.handleError(err, 'Falha ao abrir editor de foto.');
    }
  }

  // ===========================================================================
  // Error handling
  // ===========================================================================

  private handleError(err: unknown, userMsg: string): void {
    try {
      this.errorNotifier.showError(userMsg);
    } catch {
      // best-effort
    }

    const e =
      err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : 'Unknown error');

    try {
      this.globalError.handleError(e);
    } catch {
      // best-effort
    }

    this.dbg('error', { userMsg, err: e });
  }
} // Linha 374, fim do links-interaction.component.ts
