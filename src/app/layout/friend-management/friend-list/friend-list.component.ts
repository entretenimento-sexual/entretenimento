//src\app\layout\friend.management\friend-list\friend-list.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { Observable, combineLatest } from 'rxjs';

import { UserCardComponent } from 'src/app/shared/user-card/user-card.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

type SortKey = 'none' | 'recent' | 'online' | 'distance' | 'alpha';
type IUserForCard = IUserDados & {
  distanceKm?: number | null;
  lastInteractionAt?: number | null;
};

@Component({
  selector: 'app-friend-list',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, UserCardComponent],
  templateUrl: './friend-list.component.html',
  styleUrls: ['./friend-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendListComponent {
  /** 🔹 dados vindos do container (selector/slice paginado, etc.) */
  readonly items = input<readonly any[]>([]);

  /** 🔹 controles opcionais */
  readonly isLoading = input<boolean>(false);
  readonly reachedEnd = input<boolean>(false);
  readonly limit = input<number>(0);
  readonly displayMode = input<'dashboard' | 'full'>('full');
  /** 'none' = já vem ordenado/filtrado do container */
  readonly sortBy = input<SortKey>('none');
  readonly filters = input<{ onlyOnline?: boolean; q?: string }>({});
  /** 🔹 amigos aceitos apenas (default: true) */
  readonly onlyAccepted = input<boolean>(true);

  /** 🔹 distância como nos “online” (se tiver coords em ambos) */
  readonly computeDistance = input<boolean>(false);
  readonly currentUser = input<IUserDados | null>(null);

  private readonly items$ = toObservable(this.items);
  private readonly sortBy$ = toObservable(this.sortBy);
  private readonly filters$ = toObservable(this.filters);
  private readonly limit$ = toObservable(this.limit);
  private readonly onlyAccepted$ = toObservable(this.onlyAccepted);
  private readonly computeDist$ = toObservable(this.computeDistance);
  private readonly currentUser$ = toObservable(this.currentUser);

  /** 🔎 aplica filtros/ordenação quando pedido e normaliza p/ UserCard */
  visibleUsers$: Observable<IUserForCard[]> = combineLatest([
    this.items$, this.sortBy$, this.filters$, this.limit$,
    this.onlyAccepted$, this.computeDist$, this.currentUser$
  ]).pipe(
    map(([raw, sortKey, f, lim, onlyAccepted, doDist, me]) => {
      let list = [...(raw ?? [])];

      // 0) só aceitos (quando o slice ainda mistura pendentes/bloqueados)
      if (onlyAccepted) {
        list = list.filter(i => (i.status ?? i.friendStatus ?? 'accepted') === 'accepted');
      }

      // 1) filtro: só online
      if (f?.onlyOnline) {
        list = list.filter(i => !!(i.isOnline ?? i.online));
      }

      // 2) filtro: texto (nickname/name/uid)
      const q = (f?.q ?? '').trim().toLowerCase();
      if (q) {
        list = list.filter(i => {
          const name = (i.name ?? i.displayName ?? i.nickname ?? '').toLowerCase();
          const uid = String(i.uid ?? i.friendUid ?? '').toLowerCase();
          return name.includes(q) || uid.includes(q);
        });
      }

      // 3) ordenação opcional
      switch (sortKey) {
        case 'online':
          list.sort((a, b) => Number(b.isOnline ?? b.online) - Number(a.isOnline ?? a.online));
          break;
        case 'alpha':
          list.sort((a, b) => (a.name ?? a.nickname ?? '').localeCompare(b.name ?? b.nickname ?? ''));
          break;
        case 'distance':
          list.sort((a, b) => (this.readDistance(a, me, doDist) - this.readDistance(b, me, doDist)));
          break;
        case 'recent':
          list.sort((a, b) => (this.readLastInteraction(b) - this.readLastInteraction(a)));
          break;
        case 'none':
        default:
          // já vem ordenado do container
          break;
      }

      // 4) limit opcional (0 = sem limite)
      if ((lim ?? 0) > 0) list = list.slice(0, lim!);

      // 5) normalização + distância
      return list.map(i => this.toUserDados(i, me, doDist));
    })
  );

  trackByUid = (_: number, u: IUserForCard) => u.uid;

  // ===== Normalização =====
  private toUserDados(i: any, me: IUserDados | null, doDist: boolean): IUserForCard {
    const lastInteractionAt = this.readLastInteraction(i);
    const distanceKm = this.readDistance(i, me, doDist);

    return {
      uid: i.uid ?? i.friendUid ?? i.id,
      nickname: i.nickname ?? i.name ?? i.displayName ?? (i.uid ?? i.friendUid ?? ''),
      photoURL: i.photoURL ?? i.avatarUrl ?? i.photoUrl ?? '',
      isOnline: !!(i.isOnline ?? i.online),
      descricao: i.bio ?? i.descricao ?? '',
      municipio: i.municipio ?? i.city ?? '',
      estado: i.estado ?? i.state ?? '',
      // extras
      distanceKm,
      lastInteractionAt,
      idade: i.idade,
      gender: i.gender,
      lastLogin: i.lastLogin,
    } as IUserForCard;
  }

  /** Usa acceptedAt, lastInteractionAt (ms) ou Timestamp.toMillis() */
  private readLastInteraction(i: any): number {
    const cand = i.lastInteractionAt ?? i.acceptedAt ?? i.respondedAt ?? i.updatedAt;
    if (typeof cand === 'number') return cand;
    if (cand?.toMillis) return cand.toMillis();
    if (typeof cand?.seconds === 'number') return cand.seconds * 1000;
    return 0;
    // observação: se você já guarda lastMessageAt/lastContactAt, pode preferir aqui
  }

  /** Distância: prioriza valor já pronto; senão calcula com Haversine se solicitado */
  private readDistance(i: any, me: IUserDados | null, doDist: boolean): number {
    const ready = i.distanceKm ?? i.distance;
    if (typeof ready === 'number') return ready;

    if (!doDist) return Number.POSITIVE_INFINITY;
    const fLat = i.latitude ?? i.lat;
    const fLng = i.longitude ?? i.lng;
    const uLat = me?.latitude ?? (me as any)?.lat;
    const uLng = me?.longitude ?? (me as any)?.lng;
    if ([fLat, fLng, uLat, uLng].some(v => typeof v !== 'number')) {
      return Number.POSITIVE_INFINITY;
    }
    return this.haversineKm(uLat!, uLng!, fLat!, fLng!);
  }

  /** Haversine simples (km) — suficiente para o card, sem depender de serviço */
  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10; // 1 casa decimal como no online
  }
}
