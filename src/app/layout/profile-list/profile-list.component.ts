// src/app/layout/profile-list/profile-list.component.ts
// Observa o usuário autenticado e busca perfis públicos sugeridos.
// Ajustes deste arquivo:
// - loading e erro reais na UI
// - filtro do próprio usuário fora da lista
// - compatível com OnPush via markForCheck()
// - debug enxuto em ambiente não produtivo
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-profile-list',
  templateUrl: './profile-list.component.html',
  styleUrls: ['./profile-list.component.css', '../layout-profile-exibe.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ProfileListComponent implements OnInit {
  private readonly userStore = inject(CurrentUserStoreService);
  private readonly firestoreQuery = inject(FirestoreQueryService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly debug = !environment.production;

  /** Usuário autenticado (ou null) */
  user: IUserDados | null = null;

  /** Perfis sugeridos para exibição */
  profiles: IUserDados[] = [];

  /** Estados simples de UX */
  loading = false;
  loadError = false;

  ngOnInit(): void {
    this.userStore.user$
      .pipe(
        map((user) => user ?? null),
        distinctUntilChanged((a, b) => (a?.uid ?? null) === (b?.uid ?? null)),
        switchMap((currentUser) => {
          this.user = currentUser;
          this.loadError = false;

          if (!currentUser?.uid) {
            this.loading = false;
            this.profiles = [];
            this.cdr.markForCheck();
            return of<IUserDados[]>([]);
          }

          this.loading = true;
          this.cdr.markForCheck();

          return this.firestoreQuery.getSuggestedProfiles().pipe(
            map((profiles) =>
              (profiles ?? []).filter((profile) => !!profile?.uid && profile.uid !== currentUser.uid)
            ),
            catchError((err) => {
              this.dbg('Erro ao buscar perfis sugeridos', err);
              this.loadError = true;
              return of<IUserDados[]>([]);
            }),
            finalize(() => {
              this.loading = false;
              this.cdr.markForCheck();
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((profiles) => {
        this.profiles = profiles ?? [];
        this.cdr.markForCheck();
      });
  }

  /** trackBy para @for — evita recriar a lista inteira */
  trackByUid = (_: number, profile: IUserDados) => profile?.uid ?? profile;

  /** Rótulo coerente para UI */
  displayName(profile: IUserDados): string {
    return profile?.nickname || profile?.nome || 'Usuário Anônimo';
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.debug(`[ProfileListComponent] ${message}`, extra ?? '');
  }
}
