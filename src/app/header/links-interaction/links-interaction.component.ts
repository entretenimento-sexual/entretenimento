// src/app/header/links-interaction/links-interaction.component.ts
// Componente para interação com links no cabeçalho.
// ✅ Padrão “plataforma grande” (simplificado): ESTE componente governa start/stop dos listeners
//   - Gate: auth ready + logged + fora do fluxo de registro
//   - Centraliza: unread-messages + friend-requests realtime
//   - Evita: múltiplos starts vindos de telas (ex.: FriendRequestsComponent)
//
// Observações:
// - Observable-first (nada de “async solto” para governança)
// - Erros: centralizados via GlobalErrorHandlerService + ErrorNotificationService
// - Mantém nomenclaturas públicas usadas no template (refreshInboundOnOpen/accept/decline/block etc)

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, DestroyRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Store } from '@ngrx/store';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { Observable, combineLatest, defer, from, of } from 'rxjs';
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { environment } from 'src/environments/environment';

import { UploadPhotoComponent } from 'src/app/shared/components-globais/upload-photo/upload-photo.component';
import { PhotoEditorComponent } from 'src/app/photo-editor/photo-editor/photo-editor.component';

import { SidebarService } from 'src/app/core/services/sidebar.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
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

  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionService);

  // ✅ Centralização de erros (governança + side-effects não devem “derrubar” UI)
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly errorNotifier = inject(ErrorNotificationService);

  // ===========================================================================
  // UI
  // ===========================================================================

  sidebarOpen$ = this.sidebarService.isSidebarVisible$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ===========================================================================
  // Auth / Gate
  // ===========================================================================

  /**
   * ✅ Gate de prontidão do AuthSession
   * - Evita iniciar listeners no cold start quando o Auth ainda está “restaurando”.
   */
  private readonly authReady$ = defer(() => from(this.authSession.whenReady())).pipe(
    map(() => true),
    startWith(false),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ✅ Fonte canônica de UID: AuthSession.uid$
   * (Evita múltiplas subscriptions em authUser$ e decisões cedo demais.)
   */
  private readonly authUid$ = this.authSession.uid$.pipe(
    map((uid) => (uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Exposto ao template */
  userId$: Observable<string | null> = this.authUid$;

  /** Exposto ao template */
  isLogged$: Observable<boolean> = this.authUid$.pipe(
    map((uid) => !!uid),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // ===========================================================================
  // Roteamento (gate “fora do registro”)
  // ===========================================================================

  /** ✅ mesmo regex do Orchestrator (mantém coerência global) */
  private inRegistrationFlow(url: string): boolean {
    return /^\/(register(\/|$)|__\/auth\/action|post-verification\/action)/.test(url || '');
  }

  private readonly url$ = this.router.events.pipe(
    filter((e): e is NavigationEnd => e instanceof NavigationEnd),
    map((e) => e.urlAfterRedirects || e.url),
    startWith(this.router.url || ''),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly inReg$ = this.url$.pipe(
    map((url) => this.inRegistrationFlow(url)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ✅ Pode iniciar realtime?
   * - authReady === true
   * - uid != null (logged)
   * - fora do registro
   */
  private readonly canListen$ = combineLatest([this.authReady$, this.authUid$, this.inReg$]).pipe(
    map(([ready, uid, inReg]) => ready === true && !!uid && inReg === false),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * ✅ UID efetivo para governança de listeners.
   * - Quando gate fecha, vira null → stop geral.
   * - Quando gate abre, vira uid → start geral.
   */
  private readonly realtimeUid$ = combineLatest([this.authUid$, this.canListen$]).pipe(
    map(([uid, can]) => (uid && can) ? uid : null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Guarda o UID “ativo” para fazer stop/start limpo em mudança de conta. */
  private activeUid: string | null = null;

  // ===========================================================================
  // Store selectors (template)
  // ===========================================================================

  // Contadores
  pendingFriendReqCount$ = this.store.select(selectInboundRequestsCount);
  unreadMessagesCount$ = this.notificationService.unreadMessagesCount$;
  pendingInvitesCount$ = this.notificationService.pendingInvitesCount$;

  // Mini-inbox
  inboundRequestsVM$ = this.store.select(selectInboundRequestsRichVM);

  // ===========================================================================
  // Debug
  // ===========================================================================

  private dbg(...args: any[]) {
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
     * ✅ Governança central de listeners (start/stop)
     * - Um único lugar toma a decisão
     * - Telas não iniciam listeners (somente consomem state)
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
     * ✅ Log com rate-limit para não “matar” console
     */
    combineLatest([this.authUid$, this.authReady$, this.inReg$, this.canListen$, this.url$])
      .pipe(
        auditTime(250),
        tap(([uid, ready, inReg, can, url]) => this.dbg('gate', { uid, ready, inReg, can, url })),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    // Garantia extra: stop geral no destroy (mesmo se o gate já tiver fechado).
    this.safeStopAll('destroy');
  }

  // ===========================================================================
  // Gate apply (start/stop central)
  // ===========================================================================

  /**
   * Aplica transição do gate com idempotência e limpeza.
   * - uid === null: stop tudo
   * - uid !== null: garante start tudo (se mudou de UID, stop do anterior antes)
   */
  private applyRealtimeGate(uid: string | null): void {
    // Gate fechou
    if (!uid) {
      if (this.activeUid) this.dbg('gate-off -> stopping (activeUid existed)', this.activeUid);
      this.activeUid = null;
      this.safeStopAll('gate-off');
      return;
    }

    // Gate abriu (ou trocou UID)
    if (this.activeUid && this.activeUid !== uid) {
      this.dbg('uid-change -> stopping previous', { from: this.activeUid, to: uid });
      this.safeStopAll('uid-change');
    }

    // Se já está ativo com esse uid, não faz nada (idempotente)
    if (this.activeUid === uid) return;

    this.activeUid = uid;
    this.dbg('gate-on -> starting realtime', { uid });

    this.safeStartAll(uid);
  }

  private safeStartAll(uid: string): void {
    // unread messages
    try {
      this.notificationService.monitorUnreadMessages(uid);
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar monitoramento de mensagens.');
    }

    // friend requests (load + realtime)
    try {
      // “load” ajuda a preencher rápido no open (e evita depender só do realtime)
      this.store.dispatch(A.loadInboundRequests({ uid }));
      this.store.dispatch(A.loadOutboundRequests({ uid }));

      // listeners realtime
      this.store.dispatch(RT.startInboundRequestsListener({ uid }));
      this.store.dispatch(RT.startOutboundRequestsListener({ uid }));
    } catch (err) {
      this.handleError(err, 'Falha ao iniciar listeners de solicitações.');
    }
  }

  private safeStopAll(reason: string): void {
    // unread messages
    try {
      this.notificationService.stopUnreadMessagesMonitoring(reason);
    } catch (err) {
      this.handleError(err, 'Falha ao parar monitoramento de mensagens.');
    }

    // friend requests listeners
    try {
      this.store.dispatch(RT.stopInboundRequestsListener());
      this.store.dispatch(RT.stopOutboundRequestsListener());
    } catch (err) {
      this.handleError(err, 'Falha ao parar listeners de solicitações.');
    }
  }

  // ===========================================================================
  // Mini-menu actions (sempre respeitam o gate)
  // ===========================================================================

  /**
   * Ao abrir o menu, “puxa” inbound para garantir estado fresco.
   * - Usa realtimeUid$ para garantir gate aberto (logged+ready+fora do registro).
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
    // decline não precisa de uid no payload atual
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  async block(req: { id: string; requesterUid: string }): Promise<void> {
    const me = await this.getRealtimeUidOnce();
    if (!me) return;

    this.store.dispatch(A.blockUser({ ownerUid: me, targetUid: req.requesterUid }));
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  /**
   * ✅ Helper: pega 1x o UID já “gateado” (ou null).
   * - Evita padrão frágil “pega uid e depois descobre que gate fechou”.
   */
  private async getRealtimeUidOnce(): Promise<string | null> {
    try {
      const uid = await (await import('rxjs')).firstValueFrom(
        this.realtimeUid$.pipe(take(1))
      );
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

      // EventEmitter é Observable-like: podemos limitar a 1 evento.
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
  // Error handling (centralizado)
  // ===========================================================================

  private handleError(err: unknown, userMsg: string): void {
    // UX: toast amigável
    try {
      this.errorNotifier.showError(userMsg);
    } catch {
      // best-effort (não derruba)
    }

    // Diagnóstico: global handler
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error');
    try {
      this.globalError.handleError(e);
    } catch {
      // best-effort
    }

    this.dbg('error', { userMsg, err: e });
  }
} // Linha 405 - Fim do LinksInteractionComponent
