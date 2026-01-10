// src/app/layout/friend.management/friend-cards/friend-cards.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

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
  readonly items = input<readonly any[]>([]);
  readonly isLoading = input<boolean>(false);
  readonly reachedEnd = input<boolean>(false);
  readonly limit = input<number>(0);
  readonly displayMode = input<'dashboard' | 'full'>('full');
  readonly sortBy = input<SortKey>('none');
  readonly filters = input<{ onlyOnline?: boolean; q?: string }>({});

  private readonly items$ = toObservable(this.items);

  visibleUsers$: Observable<UserForCard[]> = this.items$.pipe(
    map((raw) => raw ?? []),
    map(list => {
      const f = this.filters();
      let out = [...list];

      if (f?.onlyOnline) out = out.filter(i => !!(i.isOnline ?? i.online));

      const q = (f?.q ?? '').trim().toLowerCase();
      if (q) {
        out = out.filter(i => {
          const name = (i.name ?? i.displayName ?? i.nickname ?? '').toLowerCase();
          const id = String(i.uid ?? i.friendUid ?? '').toLowerCase();
          return name.includes(q) || id.includes(q);
        });
      }

      switch (this.sortBy()) {
        case 'online':
          out.sort((a, b) => Number(b.isOnline ?? b.online) - Number(a.isOnline ?? a.online));
          break;
        case 'alpha':
          out.sort((a, b) => (a.name ?? a.nickname ?? '').localeCompare(b.name ?? b.nickname ?? ''));
          break;
        case 'distance':
          out.sort((a, b) =>
            (a.distanceKm ?? a.distanciaKm ?? a.distance ?? Infinity) -
            (b.distanceKm ?? b.distanciaKm ?? b.distance ?? Infinity)
          );
          break;
        case 'recent':
          out.sort((a, b) => (b.lastInteractionAt ?? 0) - (a.lastInteractionAt ?? 0));
          break;
        case 'none':
        default:
          break;
      }

      const lim = this.limit() ?? 0;
      if (lim > 0) out = out.slice(0, lim);
      return out.map(this.toUserForCard);
    }),
  );

  trackByUid = (_: number, u: UserForCard) => u.uid;

  // 🔧 Preenche campos obrigatórios de IUserDados com defaults
  private toUserForCard = (i: any): UserForCard => ({
    uid: i.uid ?? i.friendUid ?? i.id,
    nickname: i.nickname ?? i.name ?? i.displayName ?? (i.uid ?? i.friendUid ?? ''),
    photoURL: i.photoURL ?? i.avatarUrl ?? i.photoUrl ?? '',
    isOnline: !!(i.isOnline ?? i.online),

    // localização/descrição
    descricao: i.bio ?? i.descricao ?? '',
    municipio: i.municipio ?? i.city ?? '',
    estado: i.estado ?? i.state ?? '',

    // infos pessoais (opcionais no seu fluxo)
    idade: i.idade ?? i.age ?? null,
    gender: i.gender ?? i.genero ?? null,
    lastLogin: i.lastLogin ?? i.lastSeen ?? i.updatedAt ?? null,

    // ✅ obrigatórios do seu IUserDados
    email: i.email ?? '',
    role: (i.role ?? 'free') as any,           // ajuste se tiver um tipo/enum específico
    isSubscriber: !!(i.isSubscriber ?? i.isPro ?? i.premium),

    // outros comuns no seu projeto
    emailVerified: !!i.emailVerified,

    // distância padronizada
    distanciaKm: i.distanciaKm ?? i.distanceKm ?? i.distance ?? null,
  });
}
