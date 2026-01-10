import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { finalize, switchMap, catchError, distinctUntilChanged, map, startWith } from 'rxjs/operators';
import { of } from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

  /** Usuário autenticado (ou null) — usado se precisar personalizar a lista */
  user: IUserDados | null = null;

  /** Perfis sugeridos para exibição */
  profiles: IUserDados[] = [];

  /** Sinais simples de UX */
  loading = false;
  loadError = false;

  ngOnInit(): void {
    // Observa mudanças do usuário atual (normalizando undefined -> null),
    // evita refetch quando o uid não muda e busca sugestões quando há login.
    this.userStore.user$
      .pipe(
        startWith(undefined),
        map(u => u ?? null),
        distinctUntilChanged((a, b) => (a?.uid ?? null) === (b?.uid ?? null)),
        switchMap((currentUser) => {
          this.user = currentUser;
          this.loadError = false;

          if (!currentUser) {
            // Sem usuário => não buscar sugestões
            this.loading = false;
            return of<IUserDados[]>([]);
          }

          // Com usuário => buscar sugestões
          this.loading = true;
          return this.firestoreQuery.getSuggestedProfiles().pipe(
            catchError((err) => {
              // Log enxuto: deixe detalhes no console e apenas sinalize no UI
              console.error('[ProfileListComponent] Erro ao buscar perfis sugeridos:', err);
              this.loadError = true;
              return of<IUserDados[]>([]);
            }),
            finalize(() => {
              this.loading = false;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((profiles) => {
        this.profiles = profiles ?? [];
      });
  }

  /** trackBy para @for — evita recriar DOM inteiro a cada emissão */
  trackByUid = (_: number, p: IUserDados) => p?.uid ?? p;

  /** Helper simples para exibir rótulo coerente */
  displayName(p: IUserDados): string {
    return p?.nickname || p?.nome || 'Usuário Anônimo';
  }
}
