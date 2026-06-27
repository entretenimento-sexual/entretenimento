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
      description: 'Abra um perfil pela descoberta e use Denunciar perfil para enviar uma ocorrência à equipe interna.',
      route: ['/dashboard/explorar'],
      icon: '🚩',
      ariaLabel: 'Ir para descoberta para localizar um perfil e enviar denúncia',
      variant: 'primary',
    },
    {
      id: 'blocked-users',
      title: 'Perfis bloqueados',
      description: 'Revise pessoas bloqueadas e mantenha controle sobre quem pode tentar contato.',
      route: ['/friends/blocked'],
      icon: '⛔',
      ariaLabel: 'Abrir lista de perfis bloqueados',
      variant: 'primary',
    },
    {
      id: 'friend-requests',
      title: 'Solicitações',
      description: 'Aceite, recuse ou bloqueie convites antes que alguém possa iniciar conversa.',
      route: ['/friends/requests'],
      icon: '🤝',
      ariaLabel: 'Abrir solicitações de conexão',
      variant: 'secondary',
    },
    {
      id: 'preferences',
      title: 'Preferências',
      description: 'Ajuste descoberta, privacidade e sinais usados para recomendar perfis.',
      route: ['/preferencias'],
      icon: '⚙️',
      ariaLabel: 'Abrir preferências da conta',
      variant: 'neutral',
    },
  ];

  readonly safetyGuides: readonly SafetyGuide[] = [
    {
      id: 'report-when-needed',
      title: 'Denuncie o que precisa de revisão',
      description: 'A denúncia é enviada para análise interna. A fila, decisões e histórico não ficam visíveis para usuários comuns.',
      icon: '🚩',
    },
    {
      id: 'block-first',
      title: 'Bloqueie quando houver risco',
      description: 'O bloqueio é a resposta imediata para interromper contato indesejado ou comportamento invasivo.',
      icon: '🛡️',
    },
    {
      id: 'review-before-chat',
      title: 'Conexão antes do chat',
      description: 'Conversa direta depende de conexão aceita. Isso reduz spam e contato fora de contexto.',
      icon: '🔐',
    },
    {
      id: 'protect-personal-data',
      title: 'Proteja dados pessoais',
      description: 'Evite compartilhar documentos, endereço, dados financeiros ou rotinas sensíveis em conversas iniciais.',
      icon: '👁️',
    },
  ];

  readonly upcomingControls: readonly SafetyGuide[] = [
    {
      id: 'admin-review-flow',
      title: 'Revisão interna',
      description: 'Camada interna para priorizar, revisar e registrar decisões administrativas sem expor a fila aos usuários.',
      icon: '🧭',
    },
    {
      id: 'visibility-controls',
      title: 'Controles de visibilidade',
      description: 'Próxima camada: refinar quem pode encontrar, ver detalhes e iniciar aproximação.',
      icon: '🎚️',
    },
    {
      id: 'trust-signals',
      title: 'Sinais de confiança',
      description: 'Próxima camada: destacar perfil completo, e-mail verificado e comportamento seguro.',
      icon: '✅',
    },
  ];

  trackById(_: number, item: SafetyAction | SafetyGuide): string {
    return item.id;
  }
}
