// src/app/core/services/navigation/sidebar.service.ts
// Serviço global do sidebar universal.
//
// Responsabilidades:
// - controlar abertura/fechamento
// - controlar colapso/expansão
// - derivar seção ativa pela rota
// - expor VM reativa para shell/sidebar
//
// Compatibilidade:
// - mantém aliases legados usados por componentes antigos
//
// Observação desta fase:
// - a configuração estrutural do menu fica em sidebar-config.ts
// - este service apenas combina:
//   1) contexto de rota
//   2) viewport/mobile
//   3) capacidades de acesso
//   4) estado visual local
//
// Importante:
// - não consulta Firestore diretamente
// - não busca dados de domínio
// - mantém fallback seguro em caso de erro
import { Injectable } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import { AuthRouteContextService } from '@core/services/autentication/auth/auth-route-context.service';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

import {
  SidebarSection,
  SidebarSectionKey,
  buildSidebarSections,
  resolveSidebarSectionFromUrl,
} from '@core/services/navigation/sidebar-config';

export interface SidebarVm {
  isMobile: boolean;
  isOpen: boolean;
  isCollapsed: boolean;
  currentUrl: string;
  currentSection: SidebarSectionKey;
  sections: SidebarSection[];
}

@Injectable({ providedIn: 'root' })
export class SidebarService {
  /**
   * Estado visual local do sidebar.
   *
   * Regras:
   * - desktop: sidebar sempre "aberto" visualmente, mas pode ficar colapsado
   * - mobile: sidebar respeita abertura/fechamento real
   */
  private readonly isOpenSubject = new BehaviorSubject<boolean>(true);
  private readonly isCollapsedSubject = new BehaviorSubject<boolean>(false);

  readonly isOpen$ = this.isOpenSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly isCollapsed$ = this.isCollapsedSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Alias legado.
   * Mantido para compatibilidade com componentes antigos.
   */
  readonly isSidebarVisible$ = this.isOpen$;

  readonly isMobile$: Observable<boolean> = this.breakpointObserver
    .observe('(max-width: 991.98px)')
    .pipe(
      map((state) => state.matches),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((err): Observable<boolean> =>
        this.handleStreamError<boolean>('isMobile$', false, err)
      )
    );

  readonly currentUrl$: Observable<string> = this.routeContext.currentUrl$.pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError((err): Observable<string> =>
      this.handleStreamError<string>('currentUrl$', '/', err)
    )
  );

  readonly currentSection$: Observable<SidebarSectionKey> = this.currentUrl$.pipe(
    map((url): SidebarSectionKey => resolveSidebarSectionFromUrl(url)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError((err): Observable<SidebarSectionKey> =>
      this.handleStreamError<SidebarSectionKey>('currentSection$', 'unknown', err)
    )
  );

  /**
   * Seções efetivamente renderizáveis no sidebar.
   *
   * Fonte:
   * - regras puras do sidebar-config.ts
   * - capacidades derivadas pelo AccessControlService
   */
  readonly sections$: Observable<SidebarSection[]> = combineLatest([
    this.access.isSubscriber$,
    this.access.hasAny$(['vip']),
    this.access.hasAny$(['admin']),
  ]).pipe(
    map(([isSubscriber, isVip, isAdmin]) =>
      buildSidebarSections({
        isSubscriber,
        isVip,
        isAdmin,
      })
    ),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError((err): Observable<SidebarSection[]> =>
      this.handleStreamError<SidebarSection[]>('sections$', [], err)
    )
  );

  readonly vm$: Observable<SidebarVm> = combineLatest([
    this.isMobile$,
    this.isOpen$,
    this.isCollapsed$,
    this.currentUrl$,
    this.currentSection$,
    this.sections$,
  ]).pipe(
    map(([isMobile, isOpen, isCollapsed, currentUrl, currentSection, sections]): SidebarVm => ({
      isMobile,
      isOpen: isMobile ? isOpen : true,
      isCollapsed: isMobile ? false : isCollapsed,
      currentUrl,
      currentSection,
      sections,
    })),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true }),
    catchError((err): Observable<SidebarVm> =>
      this.handleStreamError<SidebarVm>(
        'vm$',
        {
          isMobile: false,
          isOpen: true,
          isCollapsed: false,
          currentUrl: '/',
          currentSection: 'unknown',
          sections: [],
        },
        err
      )
    )
  );

  constructor(
    private readonly breakpointObserver: BreakpointObserver,
    private readonly routeContext: AuthRouteContextService,
    private readonly access: AccessControlService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  open(): void {
    this.isOpenSubject.next(true);
  }

  close(): void {
    this.isOpenSubject.next(false);
  }

  toggle(): void {
    this.isOpenSubject.next(!this.isOpenSubject.value);
  }

  expand(): void {
    this.isCollapsedSubject.next(false);
  }

  collapse(): void {
    this.isCollapsedSubject.next(true);
  }

  toggleCollapse(): void {
    this.isCollapsedSubject.next(!this.isCollapsedSubject.value);
  }

  closeIfMobile(isMobile: boolean): void {
    if (!isMobile) return;
    this.close();
  }

  // ===========================================================================
  // Compat legado
  // ===========================================================================

  showSidebar(): void {
    this.open();
  }

  hideSidebar(): void {
    this.close();
  }

  toggleSidebar(): void {
    this.toggle();
  }

  private handleStreamError<T>(context: string, fallback: T, err: unknown): Observable<T> {
    try {
      const error = err instanceof Error ? err : new Error(`[SidebarService] ${context}`);
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }

    return of(fallback);
  }
}