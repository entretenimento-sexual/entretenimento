// src/app/core/services/autentication/auth/auth-return-url.service.ts
// Service responsável por guardar o "último destino útil" (pós-login) e resolver redirects.
//
// Por que isso é padrão em plataformas grandes:
// - Usuário autenticado que cai em /login ou /register deve ir para o "último lugar" onde estava.
// - Evita UX ruim (ficar vendo tela de login estando logado).
// - Evita open-redirect (não aceitamos URL externa em redirectTo).
//
// Regras principais:
// - Só armazena URLs internas e "úteis" (não armazena /login, /register, handlers de verificação etc.)
// - Persiste em localStorage (sobrevive refresh).
// - Limpa ao deslogar (evita “vazar” destino de sessão anterior).
import { DestroyRef, Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthReturnUrlService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authSession = inject(AuthSessionService);

  private readonly STORAGE_KEY = 'auth:lastReturnUrl';

  // Rotas que NÃO devem ser guardadas como "destino útil"
  private readonly EXCLUDED_PREFIXES = [
    '/login',
    '/register',
    '/post-verification/action',
    '/__/auth/action',
  ];

  private readonly lastUrlSubject = new BehaviorSubject<string | null>(this.readFromStorage());

  /**
   * Stream reativa:
   * - distinctUntilChanged: evita emitir repetido
   * - shareReplay: permite múltiplos subscribers sem reprocessar
   */
  readonly lastUrl$ = this.lastUrlSubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    // 1) Track de navegação: salva o último "destino útil" após redirects.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map((e) => e.urlAfterRedirects),
        filter((url) => this.isStorable(url)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((url) => this.setLastUrl(url));

    // 2) Higiene: ao deslogar, limpa destino salvo.
    this.authSession.uid$
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        if (!uid) this.clear();
      });
  }

  /**
   * Resolve o melhor redirect (string interna) para usuário autenticado:
   * Prioridade:
   * 1) redirectTo na URL (se for seguro e interno)
   * 2) último destino guardado (se existir e for seguro)
   * 3) fallback (ex.: '/dashboard/principal')
   */
  resolveAuthedRedirect(redirectToParam: string | null, fallback: string): string {
    const fromParam = (redirectToParam ?? '').trim();
    if (this.isSafeInternalUrl(fromParam)) return fromParam;

    const last = this.lastUrlSubject.value;
    if (last && this.isSafeInternalUrl(last)) return last;

    return fallback;
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private isStorable(url: string): boolean {
    const clean = (url ?? '').trim();
    if (!this.isSafeInternalUrl(clean)) return false;

    // não salva rotas "guest" ou handlers técnicos
    if (this.EXCLUDED_PREFIXES.some((p) => clean.startsWith(p))) return false;

    // não salva rotas vazias
    if (clean === '/' || clean.length < 2) return false;

    return true;
  }

  /**
   * Proteção contra open-redirect:
   * - só aceita URLs internas começando com '/'
   * - bloqueia '//' e protocolos ('http:', 'https:', etc.)
   */
  private isSafeInternalUrl(url: string): boolean {
    const u = (url ?? '').trim();
    if (!u) return false;
    if (!u.startsWith('/')) return false;
    if (u.startsWith('//')) return false;
    if (u.includes('http:') || u.includes('https:')) return false;
    return true;
  }

  private setLastUrl(url: string): void {
    this.lastUrlSubject.next(url);
    try {
      localStorage.setItem(this.STORAGE_KEY, url);
    } catch {
      // best-effort: se storage falhar, não quebra navegação
    }
  }

  private clear(): void {
    this.lastUrlSubject.next(null);
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // best-effort
    }
  }

  private readFromStorage(): string | null {
    try {
      const v = localStorage.getItem(this.STORAGE_KEY);
      const clean = (v ?? '').trim();
      return this.isSafeInternalUrl(clean) ? clean : null;
    } catch {
      return null;
    }
  }
} //142 linhas
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
