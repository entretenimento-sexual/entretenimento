// src/app/notifications/user-activity-hub/user-activity-hub.component.ts
// -----------------------------------------------------------------------------
// USER ACTIVITY HUB
// -----------------------------------------------------------------------------
// Faixa compacta de ações logo abaixo do header.
//
// Decisões:
// - não duplica a página /notificacoes;
// - agrega notificações não lidas por tipo/rota;
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
    const groups = new Map<string, UserActivityHubAction>();

    unreadItems.forEach((item) => {
      const seed = this.toActionSeed(item);
      const current = groups.get(seed.id);

      if (!current) {
        groups.set(seed.id, seed);
        return;
      }

      groups.set(seed.id, {
        ...current,
        count: current.count + 1,
        route: current.route || seed.route,
      });
    });

    const actions = Array.from(groups.values())
      .sort((a, b) => b.priority - a.priority || b.count - a.count)
      .slice(0, 5);

    return {
      actions,
      totalUnread: unreadItems.length,
    };
  }

  private toActionSeed(item: IAppNotification): UserActivityHubAction {
    const route = this.safeRoute(item.route) ?? this.defaultRouteFor(item);
    const title = `${item.title ?? ''}`.toLowerCase();
    const body = `${item.body ?? ''}`.toLowerCase();
    const searchable = `${title} ${body}`;

    if (item.type === 'chat' || route.startsWith('/chat') && !route.includes('invite-list')) {
      return {
        id: 'messages',
        label: 'Mensagens',
        description: 'Conversas novas aguardando resposta',
        count: 1,
        icon: '💬',
        route: '/chat',
        priority: 100,
      };
    }

    if (route.includes('/chat/invite-list') || searchable.includes('solicitação de conexão')) {
      return {
        id: 'friend-requests',
        label: 'Conexões',
        description: 'Solicitações pendentes para revisar',
        count: 1,
        icon: '🤝',
        route: '/chat/invite-list',
        priority: 90,
      };
    }

    if (item.type === 'social') {
      return {
        id: 'social',
        label: 'Interações',
        description: 'Novas respostas e conexões aceitas',
        count: 1,
        icon: '✨',
        route,
        priority: 80,
      };
    }

    if (searchable.includes('sala') || searchable.includes('convite')) {
      return {
        id: 'room-invites',
        label: 'Salas',
        description: 'Convites e salas com atividade',
        count: 1,
        icon: '🚪',
        route: route.startsWith('/chat') ? route : '/chat/rooms',
        priority: 70,
      };
    }

    if (searchable.includes('local') || searchable.includes('estabelecimento')) {
      return {
        id: 'places',
        label: 'Locais',
        description: 'Novos pontos relevantes para você',
        count: 1,
        icon: '📍',
        route: route.startsWith('/descobrir') ? route : '/descobrir',
        priority: 60,
      };
    }

    if (item.type === 'user_intent_status.published') {
      return {
        id: 'today-status',
        label: 'Status de hoje',
        description: 'Disponibilidade e radar regional ativos',
        count: 1,
        icon: '⚡',
        route: '/descobrir',
        priority: 50,
      };
    }

    if (item.type === 'billing') {
      return {
        id: 'billing',
        label: 'Conta',
        description: 'Assinatura, cobrança ou plano',
        count: 1,
        icon: '⭐',
        route: '/subscription-plan',
        priority: 40,
      };
    }

    return {
      id: 'notifications',
      label: 'Notificações',
      description: 'Atualizações importantes da plataforma',
      count: 1,
      icon: '🔔',
      route: '/notificacoes',
      priority: 10,
    };
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
