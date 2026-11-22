import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { BehaviorSubject, combineLatest, distinctUntilChanged, filter, map } from 'rxjs';

import { resolveRegistrationReturnUrl } from 'src/app/register-module/data-access/register-flow.model';
import { AuthSessionService } from './auth-session.service';

interface SavedReturnUrl {
  uid: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class AuthReturnUrlService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly session = inject(AuthSessionService);
  private readonly storageKey = 'auth:lastReturnUrl';
  private readonly saved = new BehaviorSubject<SavedReturnUrl | null>(this.readFromStorage());

  readonly lastUrl$ = combineLatest([this.session.uid$, this.saved]).pipe(
    map(([uid, saved]) => saved?.uid === uid ? saved.url : null),
    distinctUntilChanged()
  );

  constructor() {
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((event) => {
      const uid = this.session.currentAuthUser?.uid;
      const url = resolveRegistrationReturnUrl(event.urlAfterRedirects);
      if (!uid || this.session.isTerminatingSnapshot || !url || url === '/') return;

      const saved = { uid, url };
      this.saved.next(saved);
      try { localStorage.setItem(this.storageKey, JSON.stringify(saved)); } catch { /* best-effort */ }
    });

    this.session.uid$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((uid) => {
      if (uid) return;
      this.saved.next(null);
      try { localStorage.removeItem(this.storageKey); } catch { /* best-effort */ }
    });
  }

  resolveAuthedRedirect(redirectToParam: string | null, fallback: string): string {
    const saved = this.saved.value;
    const uid = this.session.isTerminatingSnapshot ? null : this.session.currentAuthUser?.uid;
    return resolveRegistrationReturnUrl(redirectToParam) ??
      (saved && saved.uid === uid ? saved.url : fallback);
  }

  private readFromStorage(): SavedReturnUrl | null {
    try {
      const raw: Partial<SavedReturnUrl> | null = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
      const url = typeof raw?.url === 'string' ? resolveRegistrationReturnUrl(raw.url) : null;
      return typeof raw?.uid === 'string' && raw.uid && url ? { uid: raw.uid, url } : null;
    } catch {
      // Registros antigos não identificavam a sessão que salvou a URL.
      return null;
    }
  }
}
