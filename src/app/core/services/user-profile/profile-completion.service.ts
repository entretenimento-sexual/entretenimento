// src/app/core/services/user-profile/profile-completion.service.ts
// -----------------------------------------------------------------------------
// PROFILE COMPLETION SERVICE
// -----------------------------------------------------------------------------
// Monta um checklist visual do perfil sem escrever no Firestore.
//
// Decisões:
// - serviço puro e síncrono para facilitar reuso em dashboard/onboarding;
// - recebe IUserDados já carregado pelo store;
// - não substitui guards, validações de formulário nem regras do backend;
// - retorna links de navegação para o usuário corrigir cada pendência.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

export type ProfileChecklistItemId =
  | 'photo'
  | 'nickname'
  | 'age'
  | 'region'
  | 'preferences'
  | 'adultConsent'
  | 'visibility';

export interface IProfileChecklistItemVm {
  id: ProfileChecklistItemId;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
  actionLabel: string;
  routerLink: any[];
}

export interface IProfileChecklistVm {
  completed: number;
  total: number;
  progress: number;
  pending: number;
  isComplete: boolean;
  headline: string;
  helperText: string;
  items: IProfileChecklistItemVm[];
}

@Injectable({ providedIn: 'root' })
export class ProfileCompletionService {
  buildChecklist(user: IUserDados): IProfileChecklistVm {
    const uid = String(user.uid ?? '').trim();

    const items: IProfileChecklistItemVm[] = [
      {
        id: 'photo',
        title: 'Foto principal',
        description: 'Ajuda outras pessoas a reconhecerem seu perfil com mais confiança.',
        completed: this.hasText(user.photoURL),
        required: true,
        actionLabel: 'Adicionar foto',
        routerLink: ['/perfil', uid, 'fotos', 'upload'],
      },
      {
        id: 'nickname',
        title: 'Nickname',
        description: 'Use um nome curto para aparecer melhor nos cards e conversas.',
        completed: this.hasMinText(user.nickname, 2),
        required: true,
        actionLabel: 'Editar dados',
        routerLink: ['/perfil', uid, 'editar-dados-pessoais'],
      },
      {
        id: 'age',
        title: 'Idade',
        description: 'Confirme sua idade no perfil para manter a experiência adulta consistente.',
        completed: this.hasAdultAge(user.idade),
        required: true,
        actionLabel: 'Informar idade',
        routerLink: ['/perfil', uid, 'editar-dados-pessoais'],
      },
      {
        id: 'region',
        title: 'Cidade e UF',
        description: 'A região declarada melhora Explorar, Status de Hoje e sugestões locais.',
        completed: this.hasText(user.estado) && this.hasText(user.municipio),
        required: true,
        actionLabel: 'Atualizar região',
        routerLink: ['/perfil', uid, 'editar-dados-pessoais'],
      },
      {
        id: 'preferences',
        title: 'Preferências básicas',
        description: 'Preferências ajudam a calibrar descoberta e compatibilidade.',
        completed: Array.isArray(user.preferences) && user.preferences.length > 0,
        required: false,
        actionLabel: 'Editar preferências',
        routerLink: ['/preferencias', 'editar', uid],
      },
      {
        id: 'adultConsent',
        title: 'Consentimento adulto',
        description: 'Confirmação necessária para acessar a experiência adulta da plataforma.',
        completed: user.adultConsent?.accepted === true,
        required: true,
        actionLabel: 'Confirmar acesso',
        routerLink: ['/adulto', 'confirmar'],
      },
      {
        id: 'visibility',
        title: 'Privacidade e visibilidade',
        description: 'Revise se seu perfil aparece ou fica oculto nas áreas de descoberta.',
        completed: user.publicVisibility === 'visible' || user.publicVisibility === 'hidden',
        required: false,
        actionLabel: 'Revisar privacidade',
        routerLink: ['/preferencias', 'discovery-settings'],
      },
    ];

    const completed = items.filter((item) => item.completed).length;
    const total = items.length;
    const pending = total - completed;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    const isComplete = pending === 0;

    return {
      completed,
      total,
      progress,
      pending,
      isComplete,
      headline: isComplete
        ? 'Seu perfil está pronto para descoberta.'
        : `Complete ${pending} ${pending === 1 ? 'etapa' : 'etapas'} para melhorar sua presença.`,
      helperText: isComplete
        ? 'Você já pode usar Explorar, Status de Hoje e conversas com mais consistência.'
        : 'Priorize os itens obrigatórios primeiro. Os demais melhoram alcance e compatibilidade.',
      items,
    };
  }

  private hasText(value: unknown): boolean {
    return String(value ?? '').trim().length > 0;
  }

  private hasMinText(value: unknown, minLength: number): boolean {
    return String(value ?? '').trim().length >= minLength;
  }

  private hasAdultAge(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 18;
  }
}
