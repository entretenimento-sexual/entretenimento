// src/app/safety/safety-center/safety-center.component.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

interface SafetyAction {
  id: string;
  title: string;
  description: string;
  route: readonly string[];
  icon: string;
  ariaLabel: string;
  variant: 'primary' | 'secondary' | 'neutral';
}

interface SafetyGuide {
  id: string;
  title: string;
  description: string;
  icon: string;
}

@Component({
  selector: 'app-safety-center',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './safety-center.component.html',
  styleUrls: ['./safety-center.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SafetyCenterComponent {
  readonly primaryActions: readonly SafetyAction[] = [
    {
      id: 'report-profile',
      title: 'Enviar denúncia',
      description: 'Abra a descoberta, entre no perfil que precisa de revisão e use o botão de denúncia disponível no próprio perfil.',
      route: ['/dashboard/explorar'],
      icon: '🚩',
      ariaLabel: 'Ir para descoberta para localizar um perfil e enviar denúncia',
      variant: 'primary',
    },
    {
      id: 'blocked-users',
      title: 'Perfis bloqueados',
      description: 'Revise bloqueios ativos e mantenha controle sobre quem pode tentar se aproximar ou iniciar contato.',
      route: ['/friends/blocked'],
      icon: '⛔',
      ariaLabel: 'Abrir lista de perfis bloqueados',
      variant: 'primary',
    },
    {
      id: 'friend-requests',
      title: 'Solicitações',
      description: 'Aceite, recuse ou bloqueie pedidos antes de liberar uma nova conexão na sua rede.',
      route: ['/friends/requests'],
      icon: '🤝',
      ariaLabel: 'Abrir solicitações de conexão',
      variant: 'secondary',
    },
    {
      id: 'preferences',
      title: 'Preferências',
      description: 'Ajuste descoberta, privacidade e sinais usados para recomendar perfis compatíveis.',
      route: ['/preferencias'],
      icon: '⚙️',
      ariaLabel: 'Abrir preferências da conta',
      variant: 'neutral',
    },
  ];

  readonly safetyGuides: readonly SafetyGuide[] = [
    {
      id: 'report-when-needed',
      title: 'Denuncie com contexto',
      description: 'Use denúncia quando houver perfil, foto, mensagem ou comportamento que precise de análise. A fila e as decisões seguem internas.',
      icon: '🚩',
    },
    {
      id: 'block-first',
      title: 'Bloqueie para interromper contato',
      description: 'O bloqueio é a resposta imediata para cortar aproximação indesejada enquanto a denúncia segue para revisão, quando necessário.',
      icon: '🛡️',
    },
    {
      id: 'review-before-chat',
      title: 'Conecte antes de conversar',
      description: 'Conversa direta depende de conexão aceita. Isso reduz spam, aproximação sem contexto e contato invasivo.',
      icon: '🔐',
    },
    {
      id: 'protect-personal-data',
      title: 'Proteja dados pessoais',
      description: 'Evite compartilhar documentos, endereço, dados financeiros, rotina detalhada ou acesso a outras contas em conversas iniciais.',
      icon: '👁️',
    },
  ];

  readonly upcomingControls: readonly SafetyGuide[] = [
    {
      id: 'admin-review-flow',
      title: 'Revisão interna',
      description: 'Aprimorar priorização, análise e registro de decisões administrativas sem expor a fila aos usuários comuns.',
      icon: '🧭',
    },
    {
      id: 'visibility-controls',
      title: 'Controles de visibilidade',
      description: 'Refinar quem pode encontrar seu perfil, ver detalhes sensíveis e iniciar aproximação.',
      icon: '🎚️',
    },
    {
      id: 'trust-signals',
      title: 'Sinais de confiança',
      description: 'Destacar perfil completo, e-mail verificado, presença consistente e comportamento seguro.',
      icon: '✅',
    },
  ];

  trackById(_: number, item: SafetyAction | SafetyGuide): string {
    return item.id;
  }
}
