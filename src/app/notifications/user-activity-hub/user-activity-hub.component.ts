// src/app/notifications/user-activity-hub/user-activity-hub.component.ts
// -----------------------------------------------------------------------------
// USER ACTIVITY HUB
// -----------------------------------------------------------------------------
// Barra discreta de atalhos vivos logo abaixo do header.
//
// Decisões:
// - não duplica a página /notificacoes;
// - exibe categorias fixas para navegação previsível;
// - badges aparecem apenas quando houver pendência;
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
  id: ActivityKind;
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
  | 'central';

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

  private readonly baseActions: UserActivityHubAction[] = [
    {
      id: 'messages',
      label: 'Mensagens',
      description: 'Conversas novas aguardando resposta',
      count: 0,
      icon: '💬',
      route: '/chat',
      priority: 100,
    },
    {
      id: 'connections',
      label: 'Conexões',
      description: 'Solicitações e conexões aceitas',
      count: 0,
      icon: '🤝',
      route: '/chat/invite-list',
      priority: 90,
    },
    {
      id: 'rooms',
      label: 'Salas',
      description: 'Convites e salas com movimento',
      count: 0,
      icon: '🚪',
      route: '/chat/rooms',
      priority: 80,
    },
    {
      id: 'places',
      label: 'Locais',
      description: 'Pontos relevantes para sua região',
      count: 0,
      icon: '📍',
      route: '/descobrir',
      priority: 70,
    },
    {
      id: 'status',
      label: 'Status',
      description: 'Status de hoje e radar regional',
      count: 0,
      icon: '⚡',
      route: '/descobrir',
      priority: 60,
    },
    {
      id: 'central',
      label: 'Central',
      description: 'Todas as notificações',
      count: 0,
      icon: '🔔',
      route: '/notificacoes',
      priority: 10,
    },
  ];

  readonly vm$: Observable<UserActivityHubVm> =
    this.notifications.currentUserNotifications$.pipe(
      map((items) => this.toVm(items))
    );

  trackAction(_index: number, action: UserActivityHubAction): string {
    return action.id;
  }

  private toVm(items: IAppNotification[]): UserActivityHubVm {
    const unreadItems = (items ?? []).filter((item) => item.readAt === null);
    const counts = new Map<ActivityKind, number>();

    unreadItems.forEach((item) => {
      const kind = this.toActivityKind(item);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      counts.set('central', (counts.get('central') ?? 0) + 1);
    });

    const actions = this.baseActions.map((action) => ({
      ...action,
      count: counts.get(action.id) ?? 0,
    }));

    return {
      actions,
      totalUnread: unreadItems.length,
    };
  }

  private toActivityKind(item: IAppNotification): ActivityKind {
    const route = this.safeRoute(item.route) ?? this.defaultRouteFor(item);
    const searchable = this.searchableText(item);

    if (this.isMessageActivity(item, route, searchable)) {
      return 'messages';
    }

    if (this.isConnectionActivity(route, searchable)) {
      return 'connections';
    }

    if (this.isRoomActivity(route, searchable)) {
      return 'rooms';
    }

    if (this.isPlaceActivity(route, searchable)) {
      return 'places';
    }

    if (this.isStatusActivity(item, searchable)) {
      return 'status';
    }

    return 'central';
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
      case 'billing':
        return '/subscription-plan';
      case 'user_intent_status.published':
        return '/descobrir';
      case 'social':
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
