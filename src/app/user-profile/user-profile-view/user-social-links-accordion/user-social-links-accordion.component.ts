// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts
import {
  Component,
  HostBinding,
  Injector,
  OnDestroy,
  OnInit,
  inject,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatExpansionModule } from '@angular/material/expansion';
import { toObservable } from '@angular/core/rxjs-interop';

import {
  BehaviorSubject,
  EMPTY,
  Subject,
  combineLatest,
  of,
} from 'rxjs';
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

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';

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
  readonly uid = input<string | null | undefined>(null);
  readonly isOwner = input<boolean>(false);
  readonly compact = input<boolean>(false);
  readonly hideWhenEmpty = input<boolean>(false);

  socialLinks: IUserSocialLinks | null = null;
  normalizedLinks: Partial<Record<PlatformKey, string>> = {};
  socialLinksResolved = false;

  readonly socialMediaPlatforms: readonly Platform[] = [
    { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-square' },
    { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram' },
    { key: 'twitter', label: 'X', icon: 'fab fa-x-twitter' },
    { key: 'linkedin', label: 'LinkedIn', icon: 'fab fa-linkedin' },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube' },
    { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok' },
    { key: 'snapchat', label: 'Snapchat', icon: 'fab fa-snapchat-ghost' },
    { key: 'sexlog', label: 'Sexlog', icon: 'fas fa-link' },
    { key: 'd4swing', label: 'D4', icon: 'fas fa-link' },
    { key: 'hotvips', label: 'Hotvips', icon: 'fas fa-link' },
    { key: 'privacy', label: 'Privacy', icon: 'fas fa-link' },
    { key: 'onlyfans', label: 'OnlyFans', icon: 'fas fa-link' },
    { key: 'fansly', label: 'Fansly', icon: 'fas fa-link' },
    { key: 'linktree', label: 'Linktree', icon: 'fas fa-link' },
  ];

  private readonly destroy$ = new Subject<void>();
  private readonly loggedUid$ = new BehaviorSubject<string | null>(null);
  private readonly subscriber$ = new BehaviorSubject<boolean>(false);

  private readonly injector = inject(Injector);
  private readonly userSocialLinksService = inject(UserSocialLinksService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);
  private readonly accessControl = inject(AccessControlService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);

  private readonly profileUid$ = toObservable(this.uid, {
    injector: this.injector,
  }).pipe(
    map((value) => (value == null ? null : String(value).trim() || null)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  @HostBinding('attr.hidden')
  get hiddenWhenUnavailable(): '' | null {
    const shouldHide =
      this.hideWhenEmpty() &&
      !this.canManage() &&
      (!this.socialLinksResolved || !this.anyLinks());

    return shouldHide ? '' : null;
  }

  ngOnInit(): void {
    combineLatest([
      this.session.authUser$.pipe(
        map((user) => user?.uid ?? null),
        startWith(null),
        distinctUntilChanged()
      ),
      this.currentUserStore.user$.pipe(
        map((user) => user?.uid ?? null),
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

    this.accessControl.isSubscriber$
      .pipe(takeUntil(this.destroy$))
      .subscribe(this.subscriber$);

    const authUid$ = this.session.authUser$.pipe(
      map((user) => user?.uid ?? null),
      startWith(null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    combineLatest([this.profileUid$, this.session.ready$, authUid$])
      .pipe(
        switchMap(([profileUid, ready, authUid]) => {
          if (!profileUid) {
            this.clearState(true);
            return of(null);
          }

          if (!ready) return EMPTY;

          if (!authUid) {
            this.clearState(true);
            return of(null);
          }

          this.socialLinksResolved = false;

          return this.userSocialLinksService
            .watchSocialLinks(profileUid, {
              notifyOnError: false,
              allowAnonymousRead: false,
            })
            .pipe(
              catchError((error) => {
                this.handleError(
                  error,
                  'watchSocialLinks',
                  'Não foi possível carregar as redes sociais agora.'
                );
                return of(null);
              })
            );
        }),
        tap((links) => {
          this.socialLinks = links ?? null;
          this.normalizedLinks = this.buildNormalizedLinks(links ?? {});
          this.socialLinksResolved = true;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.loggedUid$.complete();
    this.subscriber$.complete();
  }

  anyLinks(): boolean {
    if (!this.socialLinks) return false;
    return this.socialMediaPlatforms.some(
      (platform) => !!this.socialLinks?.[platform.key]
    );
  }

  trackByKey = (_: number, item: Platform): PlatformKey => item.key;

  canManage(): boolean {
    const loggedUid = this.loggedUid$.value;
    const viewedUid = this.uid();
    return !!(
      this.isOwner() ||
      (loggedUid && viewedUid && loggedUid === viewedUid)
    );
  }

  canEdit(): boolean {
    return this.canManage() && this.subscriber$.value;
  }

  updateSocialLink(key: PlatformKey, rawValue: string): void {
    if (!this.canEdit()) {
      this.notify.showWarning(
        'Uma assinatura ativa é necessária para publicar redes sociais.'
      );
      return;
    }

    const ownerUid = this.uid();
    if (!ownerUid) return;

    const value = (rawValue ?? '').trim();
    if (!value) {
      this.removeLink(key);
      return;
    }

    if (this.isDangerousUrl(value)) {
      this.notify.showError('Link inválido. Use URL segura (https) ou @handle.');
      return;
    }

    const newLinks: IUserSocialLinks = {
      ...(this.socialLinks ?? {}),
      [key]: value,
    };
    const normalized = this.normalizeValue(key, value);

    this.userSocialLinksService
      .saveSocialLinks(ownerUid, newLinks, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        take(1),
        catchError((error) => {
          this.handleError(
            error,
            'saveSocialLinks',
            'Não foi possível publicar este link agora.'
          );
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.socialLinks = newLinks;
        this.normalizedLinks = {
          ...this.normalizedLinks,
          [key]: normalized,
        };
        this.notify.showSuccess('Rede social publicada.');
      });
  }

  removeLink(key: PlatformKey): void {
    if (!this.canManage()) {
      this.notify.showError('Você não pode alterar as redes deste perfil.');
      return;
    }

    const ownerUid = this.uid();
    if (!ownerUid) return;

    this.userSocialLinksService
      .removeLink(ownerUid, key, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        take(1),
        catchError((error) => {
          this.handleError(
            error,
            'removeLink',
            'Não foi possível remover este link agora.'
          );
          return EMPTY;
        })
      )
      .subscribe(() => {
        if (this.socialLinks) {
          const next = { ...this.socialLinks };
          delete next[key];
          this.socialLinks = next;
        }

        const normalized = { ...this.normalizedLinks };
        delete normalized[key];
        this.normalizedLinks = normalized;
        this.notify.showSuccess('Link removido.');
      });
  }

  goToEditSocialLinks(): void {
    const ownerUid = this.uid();
    if (!ownerUid || !this.canManage()) return;

    this.router
      .navigate(['/perfil', ownerUid, 'edit-profile-social-links'])
      .catch((error) =>
        this.handleError(
          error,
          'router.navigate',
          'Não foi possível abrir a edição de redes sociais.'
        )
      );
  }

  private buildNormalizedLinks(
    links: Partial<IUserSocialLinks>
  ): Partial<Record<PlatformKey, string>> {
    const out: Partial<Record<PlatformKey, string>> = {};

    (Object.keys(links) as PlatformKey[]).forEach((key) => {
      const value = String(links[key] ?? '').trim();
      if (!value || this.isDangerousUrl(value)) return;
      out[key] = this.normalizeValue(key, value);
    });

    return out;
  }

  private normalizeValue(key: PlatformKey, value: string): string {
    const cleanHandle = (handle: string) => handle.replace(/^@/, '').trim();
    const ensureHttps = (url: string) =>
      /^(https?:)?\/\//i.test(url)
        ? url.startsWith('http')
          ? url
          : `https:${url}`
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
        if (value.includes('twitter.com') || value.includes('x.com')) {
          return ensureHttps(value);
        }
        return `https://x.com/${cleanHandle(value)}`;
      case 'linkedin':
        if (/linkedin\.com\/(in|company)\//i.test(value)) {
          return ensureHttps(value);
        }
        return `https://linkedin.com/in/${cleanHandle(value)}`;
      case 'youtube':
        if (value.includes('youtube.com') || value.includes('youtu.be')) {
          return ensureHttps(value);
        }
        return `https://youtube.com/@${cleanHandle(value)}`;
      case 'tiktok':
        return value.includes('tiktok.com')
          ? ensureHttps(value)
          : `https://tiktok.com/@${cleanHandle(value)}`;
      case 'snapchat':
        return value.includes('snapchat.com')
          ? ensureHttps(value)
          : `https://snapchat.com/add/${cleanHandle(value)}`;
      default:
        return ensureHttps(value);
    }
  }

  private handleError(
    error: unknown,
    context: string,
    userMessage?: string
  ): void {
    const normalized =
      error instanceof Error
        ? error
        : new Error(`[SocialLinksAccordion] ${context}`);

    (normalized as any).silent = true;
    (normalized as any).original = error;
    (normalized as any).context = context;
    (normalized as any).skipUserNotification = true;

    this.globalError.handleError(normalized);

    if (userMessage) {
      this.notify.showError(userMessage);
    }
  }

  private isDangerousUrl(value: string): boolean {
    return /^\s*(javascript|data|vbscript):/i.test(value);
  }

  private clearState(resolved = false): void {
    this.socialLinks = null;
    this.normalizedLinks = {};
    this.socialLinksResolved = resolved;
  }
}
