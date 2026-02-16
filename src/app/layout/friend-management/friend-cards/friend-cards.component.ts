// src/app/layout/friend-management/friend-cards/friend-cards.component.ts
// Componente de exibição de cartões de amigos.
// - Recebe uma lista de amigos e exibe usando <app-user-card>.
// - Permite ordenação e filtragem local (apenas online, busca textual).
// - Componente focado em apresentação: não faz chamadas, não acessa store.
// - Reatividade: usa Signals (input()) + toObservable() para reagir a alterações.
// - Debug: logs apenas em modo dev para facilitar manutenção futura.
import { ChangeDetectionStrategy, Component, input, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';

type SortKey = 'none' | 'recent' | 'online' | 'distance' | 'alpha';

// VM consumida pelo card (IUserDados completo + distanciaKm)
type UserForCard = IUserDados & { distanciaKm?: number | null };

@Component({
  selector: 'app-friend-cards',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, UserCardComponent],
  templateUrl: './friend-cards.component.html',
  styleUrls: ['./friend-cards.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendCardsComponent {
  // =========================
  // Inputs (Signals)
  // =========================

  /** Lista bruta de itens (qualquer shape vindo do selector/página). */
  readonly items = input<readonly any[]>([]);

  /** Estado de carregamento (controlado pelo componente pai). */
  readonly isLoading = input<boolean>(false);

  /** Indica se a paginação chegou ao fim (controlado pelo componente pai). */
  readonly reachedEnd = input<boolean>(false);

  /** Limita quantidade de cards renderizados (0 = sem limite). */
  readonly limit = input<number>(0);

  /** Controla layout (compact para dashboard, full para página inteira). */
  readonly displayMode = input<'dashboard' | 'full'>('full');

  /** Chave de ordenação local. */
  readonly sortBy = input<SortKey>('none');

  /** Filtros locais simples (apenas online, busca textual). */
  readonly filters = input<{ onlyOnline?: boolean; q?: string }>({});

  // =========================
  // Debug (dev only)
  // =========================

  /** Tag usada nos logs para facilitar rastreio no console. */
  private readonly debugTag = '[FriendCards]';

  /**
   * Log controlado por isDevMode().
   * Não "polui" produção e ajuda bastante a rastrear recomputações.
   */
  private debugLog(message: string, extra?: unknown): void {
    if (!isDevMode()) return;
    // eslint-disable-next-line no-console
    console.log(`${this.debugTag} ${message}`, extra ?? '');
  }

  // =========================
  // Observables derivados
  // =========================
  // IMPORTANTE:
  // Antes, só items$ disparava recomputação.
  // Agora, qualquer mudança em filters/sortBy/limit também recalcula.

  private readonly items$ = toObservable(this.items);
  private readonly filters$ = toObservable(this.filters);
  private readonly sortBy$ = toObservable(this.sortBy);
  private readonly limit$ = toObservable(this.limit);

  /**
   * Lista visível final já filtrada/ordenada/limitada e normalizada (UserForCard).
   * shareReplay evita recomputação extra caso o template re-subscreva.
   */
  readonly visibleUsers$: Observable<UserForCard[]> = combineLatest([
    this.items$,
    this.filters$,
    this.sortBy$,
    this.limit$,
  ]).pipe(
    map(([rawItems, filters, sortBy, limit]) => {
      const list = (rawItems ?? []) as any[];

      // 1) Copiamos a lista para não mutar referência do pai
      let out = [...list];

      // 2) Filtra: onlyOnline
      if (filters?.onlyOnline) {
        out = out.filter(i => !!(i.isOnline ?? i.online));
      }

      // 3) Filtra: busca textual (nome/nickname/uid)
      const q = (filters?.q ?? '').trim().toLowerCase();
      if (q) {
        out = out.filter(i => {
          const name = (i.name ?? i.displayName ?? i.nickname ?? '').toLowerCase();
          const id = String(i.uid ?? i.friendUid ?? i.id ?? '').toLowerCase();
          return name.includes(q) || id.includes(q);
        });
      }

      // 4) Ordena conforme sortBy
      switch (sortBy) {
        case 'online':
          out.sort((a, b) => Number(b.isOnline ?? b.online) - Number(a.isOnline ?? a.online));
          break;

        case 'alpha':
          out.sort((a, b) =>
            String(a.name ?? a.nickname ?? '').localeCompare(String(b.name ?? b.nickname ?? '')),
          );
          break;

        case 'distance':
          out.sort((a, b) =>
            (a.distanceKm ?? a.distanciaKm ?? a.distance ?? Infinity) -
            (b.distanceKm ?? b.distanciaKm ?? b.distance ?? Infinity),
          );
          break;

        case 'recent':
          out.sort((a, b) => (b.lastInteractionAt ?? 0) - (a.lastInteractionAt ?? 0));
          break;

        case 'none':
        default:
          break;
      }

      // 5) Aplica limite (0 = sem limite)
      if (limit && limit > 0) out = out.slice(0, limit);

      // 6) Normaliza o shape para o <app-user-card>
      const normalized = out.map(this.toUserForCard);

      return normalized;
    }),

    // Debug: tamanho e inputs relevantes (somente dev)
    tap((arr) => {
      this.debugLog('visibleUsers$ recomputed', {
        count: arr.length,
        sortBy: this.sortBy(),
        filters: this.filters(),
        limit: this.limit(),
      });
    }),

    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * trackBy estável: evita re-render desnecessário.
   * Garante performance boa mesmo em listas maiores.
   */
  trackByUid = (_: number, u: UserForCard) => u.uid;

  /**
   * Normaliza campos obrigatórios do IUserDados, com defaults.
   * Objetivo: o card NÃO QUEBRA quando o selector retorna shapes diferentes.
   */
  private toUserForCard = (i: any): UserForCard => ({
    uid: i.uid ?? i.friendUid ?? i.id,
    nickname: i.nickname ?? i.name ?? i.displayName ?? String(i.uid ?? i.friendUid ?? ''),
    photoURL: i.photoURL ?? i.avatarUrl ?? i.photoUrl ?? '',
    isOnline: !!(i.isOnline ?? i.online),

    // localização/descrição
    descricao: i.bio ?? i.descricao ?? '',
    municipio: i.municipio ?? i.city ?? '',
    estado: i.estado ?? i.state ?? '',

    // infos pessoais (opcionais)
    idade: i.idade ?? i.age ?? null,
    gender: i.gender ?? i.genero ?? null,
    lastLogin: i.lastLogin ?? i.lastSeen ?? i.updatedAt ?? null,

    // obrigatórios do IUserDados (ajuste se seu tipo for mais restrito)
    email: i.email ?? '',
    role: (i.role ?? 'free') as any,
    isSubscriber: !!(i.isSubscriber ?? i.isPro ?? i.premium),

    // comuns no projeto
    emailVerified: !!i.emailVerified,

    // distância padronizada
    distanciaKm: i.distanciaKm ?? i.distanceKm ?? i.distance ?? null,
  });
} // 205 Linhas
