// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts
// =============================================================================
// SocialLinksAccordionComponent
//
// Componente: Acordeão de links sociais no perfil do usuário.
//
// Objetivos:
// - Exibir links sociais do perfil visualizado (uid input).
// - Permitir editar/remover se for dono (isOwner) OU se uid logado === uid exibido.
// - Reagir a mudanças do input uid() (navegação entre perfis sem destruir componente).
// - NÃO iniciar listener Firestore sem autenticação (evita 400/permission-denied).
// - Erros roteados para GlobalErrorHandlerService e feedback via ErrorNotificationService.
//
// Observações importantes (padrão “grandes plataformas”):
// - Listener realtime só inicia após:
//   1) session.ready$ === true (auth restaurada)
//   2) authUser?.uid existir (usuário autenticado)
//   3) profileUid existir
// - switchMap cancela listener anterior quando uid muda.
// - Estado do template é atualizado apenas por tap() (efeitos controlados).
// =============================================================================

import { Component, OnDestroy, OnInit, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatExpansionModule } from '@angular/material/expansion';
import { toObservable } from '@angular/core/rxjs-interop';

import { BehaviorSubject, Subject, combineLatest, of, EMPTY } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';

type PlatformKey = keyof IUserSocialLinks;
type Platform = { key: PlatformKey; label: string; icon: string };

@Component({
  selector: 'app-social-links-accordion',
  templateUrl: './user-social-links-accordion.component.html',
  styleUrls: ['./user-social-links-accordion.component.css'],
  standalone: true,
  imports: [CommonModule, MatExpansionModule],
})
export class SocialLinksAccordionComponent implements OnInit, OnDestroy {
  // --- inputs (Signal Inputs) ---
  readonly uid = input<string | null | undefined>(null); // UID do perfil exibido
  readonly isOwner = input<boolean>(false);              // Perfil é do usuário logado?

  // --- estado usado pelo template (mantido) ---
  socialLinks: IUserSocialLinks | null = null;
  normalizedLinks: Partial<Record<PlatformKey, string>> = {};

  // --- lifecycle ---
  private readonly destroy$ = new Subject<void>();

  /**
   * Snapshot do uid logado para decisões síncronas (canEdit()).
   * Preferência: AuthSessionService. Fallback: CurrentUserStoreService.
   */
  private readonly loggedUid$ = new BehaviorSubject<string | null>(null);

  // Redes suportadas (expansível):
  socialMediaPlatforms: Platform[] = [
    { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-square' },
    { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram' },
    { key: 'twitter', label: 'X (Twitter)', icon: 'fab fa-twitter' },
    { key: 'linkedin', label: 'LinkedIn', icon: 'fab fa-linkedin' },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube' },
    { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok' },
    { key: 'snapchat', label: 'Snapchat', icon: 'fab fa-snapchat-ghost' },
    { key: 'sexlog', label: 'Sexlog', icon: 'fas fa-link' },
    { key: 'd4swing', label: 'D4', icon: 'fas fa-link' },
    { key: 'buppe', label: 'Buppe', icon: 'fas fa-link' },
  ];

  // injeções
  private readonly userSocialLinksService = inject(UserSocialLinksService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    // =========================================================
    // 1) Mantém snapshot do UID logado (para canEdit)
    // =========================================================
    combineLatest([
      this.session.authUser$.pipe(
        map(u => u?.uid ?? null),
        startWith(null),
        distinctUntilChanged()
      ),
      this.currentUserStore.user$.pipe(
        map(u => u?.uid ?? null),
        startWith(null),
        distinctUntilChanged()
      ),
    ])
      .pipe(
        map(([authUid, storeUid]) => authUid ?? storeUid ?? null),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(this.loggedUid$);

    // =========================================================
    // 2) Reage a mudanças do input uid() e observa links (realtime)
    // =========================================================

    // UID do perfil exibido (normalizado)
    const profileUid$ = toObservable(this.uid).pipe(
      map(v => (v ?? null) ? String(v).trim() : null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // UID autenticado (apenas string), evita reprocessar por mudanças no objeto User
    const authUid$ = this.session.authUser$.pipe(
      map(u => u?.uid ?? null),
      startWith(null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    combineLatest([profileUid$, this.session.ready$, authUid$])
      .pipe(
        switchMap(([profileUid, ready, authUid]) => {
          // Sem uid -> limpa estado e não faz nada
          if (!profileUid) {
            this.clearState();
            return of(null);
          }

          // Sessão ainda não restaurou -> não decide cedo
          if (!ready) return of(null);

          // Regra do projeto: não iniciar listener sem autenticação
          if (!authUid) {
            // Não spammar toast aqui; somente “não carrega”
            this.clearState();
            return of(null);
          }

          // Observa links do perfil em tempo real
          return this.userSocialLinksService.watchSocialLinks(profileUid, {
            // componente já dá feedback quando necessário (evita duplicidade de toast)
            notifyOnError: false,
            allowAnonymousRead: false,
          }).pipe(
            catchError((err) => {
              this.handleError(err, 'watchSocialLinks', 'Não foi possível carregar as redes sociais agora.');
              return of(null);
            })
          );
        }),

        tap((links) => {
          this.socialLinks = links ?? null;
          this.normalizedLinks = this.buildNormalizedLinks(links ?? {});
        }),

        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.loggedUid$.complete();
  }

  // ---------------------------
  // Helpers de renderização
  // ---------------------------

  anyLinks(): boolean {
    if (!this.socialLinks) return false;
    return this.socialMediaPlatforms.some(p => !!this.socialLinks?.[p.key]);
  }

  trackByKey = (_: number, item: Platform) => item.key;

  /**
   * Mantido síncrono para compat com template.
   * - isOwner() pode vir do componente pai
   * - loggedUid$ é snapshot atualizado reativamente
   */
  canEdit(): boolean {
    const logged = this.loggedUid$.value;
    const viewed = this.uid();
    return !!(this.isOwner() || (logged && viewed && logged === viewed));
  }

  // ---------------------------
  // Ações (CRUD)
  // ---------------------------

  updateSocialLink(key: PlatformKey, rawValue: string): void {
    if (!this.canEdit()) {
      this.notify.showError('Você não pode alterar as redes deste perfil.');
      return;
    }

    const ownerUid = this.uid();
    if (!ownerUid) return;

    const value = (rawValue ?? '').trim();

    // Se apagar e salvar vazio => remoção (UX)
    if (!value) {
      this.removeLink(key);
      return;
    }

    // Hardening simples contra esquemas perigosos
    if (this.isDangerousUrl(value)) {
      this.notify.showError('Link inválido. Use URL segura (https) ou @handle.');
      return;
    }

    const newLinks: IUserSocialLinks = {
      ...(this.socialLinks ?? {}),
      [key]: value,
    };

    const normalized = this.normalizeValue(key, value);

    this.userSocialLinksService.saveSocialLinks(ownerUid, newLinks)
      .pipe(
        take(1),
        catchError((err) => {
          this.handleError(err, 'saveSocialLinks', 'Não foi possível salvar agora. Tente novamente.');
          return EMPTY;
        })
      )
      .subscribe(() => {
        // Otimista local (o watch também vai refletir)
        this.socialLinks = newLinks;
        this.normalizedLinks = { ...this.normalizedLinks, [key]: normalized };
        this.notify.showSuccess('Redes sociais atualizadas.');
      });
  }

  removeLink(key: PlatformKey): void {
    if (!this.canEdit()) {
      this.notify.showError('Você não pode alterar as redes deste perfil.');
      return;
    }

    const ownerUid = this.uid();
    if (!ownerUid) return;

    this.userSocialLinksService.removeLink(ownerUid, key)
      .pipe(
        take(1),
        catchError((err) => {
          this.handleError(err, 'removeLink', 'Não foi possível remover agora.');
          return EMPTY;
        })
      )
      .subscribe(() => {
        // Otimista local (o watch também vai refletir)
        if (this.socialLinks) {
          const clone = { ...this.socialLinks };
          delete clone[key];
          this.socialLinks = clone;
        }

        const norm = { ...this.normalizedLinks };
        delete norm[key];
        this.normalizedLinks = norm;

        this.notify.showSuccess('Link removido.');
      });
  }

  goToEditSocialLinks(): void {
    const uid = this.uid();
    if (!uid) return;

    this.router.navigate(['/perfil', uid, 'edit-profile-social-links'])
      .catch((err) => this.handleError(err, 'router.navigate', 'Não foi possível abrir a tela de edição.'));
  }

  // ---------------------------
  // Normalização de valores
  // ---------------------------

  private buildNormalizedLinks(links: Partial<IUserSocialLinks>): Partial<Record<PlatformKey, string>> {
    const out: Partial<Record<PlatformKey, string>> = {};

    (Object.keys(links) as PlatformKey[]).forEach(k => {
      const v = (links[k] ?? '').toString().trim();
      if (!v) return;
      if (this.isDangerousUrl(v)) return;
      out[k] = this.normalizeValue(k, v);
    });

    return out;
  }

  private normalizeValue(key: PlatformKey, value: string): string {
    const cleanHandle = (h: string) => h.replace(/^@/, '').trim();

    const ensureHttps = (url: string) =>
      /^(https?:)?\/\//i.test(url)
        ? (url.startsWith('http') ? url : `https:${url}`)
        : `https://${url}`;

    switch (key) {
      case 'facebook':
        return value.includes('facebook.com')
          ? ensureHttps(value)
          : `https://facebook.com/${cleanHandle(value)}`;

      case 'instagram':
        return value.includes('instagram.com')
          ? ensureHttps(value)
          : `https://instagram.com/${cleanHandle(value)}`;

      case 'twitter':
        if (value.includes('twitter.com') || value.includes('x.com')) return ensureHttps(value);
        return `https://x.com/${cleanHandle(value)}`;

      case 'linkedin':
        if (/linkedin\.com\/(in|company)\//i.test(value)) return ensureHttps(value);
        return `https://linkedin.com/in/${cleanHandle(value)}`;

      case 'youtube':
        if (value.includes('youtube.com') || value.includes('youtu.be')) return ensureHttps(value);
        return `https://youtube.com/@${cleanHandle(value)}`;

      case 'tiktok':
        return value.includes('tiktok.com')
          ? ensureHttps(value)
          : `https://tiktok.com/@${cleanHandle(value)}`;

      case 'snapchat':
        return value.includes('snapchat.com')
          ? ensureHttps(value)
          : `https://snapchat.com/add/${cleanHandle(value)}`;

      // “outros”: apenas garante https
      case 'sexlog':
      case 'd4swing':
      case 'buppe':
      default:
        return ensureHttps(value);
    }
  }

  // ---------------------------
  // Erros (centralizados)
  // ---------------------------

  private handleError(err: unknown, context: string, userMessage?: string): void {
    const e = err instanceof Error ? err : new Error(`[SocialLinksAccordion] ${context}`);
    (e as any).silent = true;
    (e as any).original = err;
    (e as any).context = context;

    this.globalError.handleError(e);

    if (userMessage) {
      this.notify.showError(userMessage);
    }
  }

  // ---------------------------
  // Hardening / util
  // ---------------------------

  private isDangerousUrl(value: string): boolean {
    return /^\s*(javascript|data|vbscript):/i.test(value);
  }

  private clearState(): void {
    this.socialLinks = null;
    this.normalizedLinks = {};
  }
}
