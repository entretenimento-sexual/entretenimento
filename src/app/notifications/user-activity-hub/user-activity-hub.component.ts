// src/app/notifications/user-activity-hub/user-activity-hub.component.ts
// -----------------------------------------------------------------------------
// USER ACTIVITY HUB
// -----------------------------------------------------------------------------
// Barra discreta de atalhos vivos logo abaixo do header.
//
// Decisões:
// - não duplica a página /notificacoes;
// - separa notificações não lidas por tipo operacional;
// - usa o stream reativo já protegido por Rules;
// - não escreve no Firestore;
// - ações de leitura seguem nas callables da central de notificações.
// -----------------------------------------------------------------------------

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { IAppNotification } from 'src/app/core/interfaces/app-notification.interface';
import { AppNotificationService } from 'src/app/core/services/notifications/app-notification.service';

interface UserActivityHubAction {
  id: string;
  label: string;
  description: string;
  count: number;
  icon: string;
  route: string;
  priority: number;
}

interface UserActivityHubVm {
  actions: UserActivityHubAction[];
  totalUnread: number;
}

type ActivityKind =
  | 'messages'
  | 'connections'
  | 'rooms'
  | 'places'
  | 'status'
  | 'account'
  | 'general';

@Component({
  selector: 'app-user-activity-hub',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './user-activity-hub.component.html',
  styleUrls: ['./user-activity-hub.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserActivityHubComponent {
  private readonly notifications = inject(AppNotificationService);

  readonly vm$: Observable<UserActivityHubVm> =
    this.notifications.currentUserNotifications$.pipe(
      map((items) => this.toVm(items))
    );

  trackAction(_index: number, action: UserActivityHubAction): string {
    return action.id;
  }

  private toVm(items: IAppNotification[]): UserActivityHubVm {
    const unreadItems = (items ?? []).filter((item) => item.readAt === null);
    const groups = new Map<ActivityKind, UserActivityHubAction>();

    unreadItems.forEach((item) => {
      const seed = this.toActionSeed(item);
      const current = groups.get(seed.id as ActivityKind);

      if (!current) {
        groups.set(seed.id as ActivityKind, seed);
        return;
      }

      groups.set(seed.id as ActivityKind, {
        ...current,
        count: current.count + 1,
        route: current.route || seed.route,
      });
    });

    const actions = Array.from(groups.values())
      .sort((a, b) => b.priority - a.priority || b.count - a.count)
      .slice(0, 6);

    return {
      actions,
      totalUnread: unreadItems.length,
    };
  }

  private toActionSeed(item: IAppNotification): UserActivityHubAction {
    const route = this.safeRoute(item.route) ?? this.defaultRouteFor(item);
    const searchable = this.searchableText(item);

    if (this.isMessageActivity(item, route, searchable)) {
      return this.buildAction({
        id: 'messages',
        label: 'Mensagens',
        description: 'Conversas novas aguardando resposta',
        icon: '💬',
        route: '/chat',
        priority: 100,
      });
    }

    if (this.isConnectionActivity(route, searchable)) {
      return this.buildAction({
        id: 'connections',
        label: 'Conexões',
        description: 'Solicitações e conexões aceitas',
        icon: '🤝',
        route: route.startsWith('/perfil/') ? route : '/chat/invite-list',
        priority: 90,
      });
    }

    if (this.isRoomActivity(route, searchable)) {
      return this.buildAction({
        id: 'rooms',
        label: 'Salas',
        description: 'Convites e salas com movimento',
        icon: '🚪',
        route: route.startsWith('/chat') ? route : '/chat/rooms',
        priority: 80,
      });
    }

    if (this.isPlaceActivity(route, searchable)) {
      return this.buildAction({
        id: 'places',
        label: 'Locais',
        description: 'Pontos relevantes para sua região',
        icon: '📍',
        route: route.startsWith('/descobrir') ? route : '/descobrir',
        priority: 70,
      });
    }

    if (this.isStatusActivity(item, searchable)) {
      return this.buildAction({
        id: 'status',
        label: 'Status',
        description: 'Status de hoje e radar regional',
        icon: '⚡',
        route: '/descobrir',
        priority: 60,
      });
    }

    if (item.type === 'billing') {
      return this.buildAction({
        id: 'account',
        label: 'Conta',
        description: 'Assinatura, cobrança ou plano',
        icon: '⭐',
        route: '/subscription-plan',
        priority: 50,
      });
    }

    return this.buildAction({
      id: 'general',
      label: 'Avisos',
      description: 'Atualizações importantes da plataforma',
      icon: '🔔',
      route: '/notificacoes',
      priority: 10,
    });
  }

  private buildAction(input: Omit<UserActivityHubAction, 'count'>): UserActivityHubAction {
    return {
      ...input,
      count: 1,
    };
  }

  private searchableText(item: IAppNotification): string {
    return `${item.title ?? ''} ${item.body ?? ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private isMessageActivity(
    item: IAppNotification,
    route: string,
    searchable: string
  ): boolean {
    return item.type === 'chat' ||
      (route.startsWith('/chat') && !route.includes('invite-list')) ||
      searchable.includes('mensagem') ||
      searchable.includes('conversa');
  }

  private isConnectionActivity(route: string, searchable: string): boolean {
    return route.includes('/chat/invite-list') ||
      route.startsWith('/friends/requests') ||
      route.startsWith('/perfil/') && searchable.includes('conexao') ||
      searchable.includes('solicitacao de conexao') ||
      searchable.includes('conexao aceita') ||
      searchable.includes('amizade');
  }

  private isRoomActivity(route: string, searchable: string): boolean {
    return route.startsWith('/chat/rooms') ||
      searchable.includes('sala') ||
      searchable.includes('convite');
  }

  private isPlaceActivity(route: string, searchable: string): boolean {
    return route.startsWith('/locais') ||
      searchable.includes('local') ||
      searchable.includes('locais') ||
      searchable.includes('estabelecimento');
  }

  private isStatusActivity(item: IAppNotification, searchable: string): boolean {
    return item.type === 'user_intent_status.published' ||
      searchable.includes('status') ||
      searchable.includes('radar') ||
      searchable.includes('disponivel hoje');
  }

  private defaultRouteFor(item: IAppNotification): string {
    switch (item.type) {
      case 'chat':
        return '/chat';
      case 'social':
        return '/notificacoes';
      case 'billing':
        return '/subscription-plan';
      case 'user_intent_status.published':
        return '/descobrir';
      case 'system':
      default:
        return '/notificacoes';
    }
  }

  private safeRoute(route: string | null): string | null {
    const normalized = String(route ?? '').trim();

    if (!normalized.startsWith('/') || normalized.startsWith('//')) {
      return null;
    }

    return normalized;
  }
}
