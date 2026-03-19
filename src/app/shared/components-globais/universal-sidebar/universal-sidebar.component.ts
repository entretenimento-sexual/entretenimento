// src/app/shared/components-globais/universal-sidebar/universal-sidebar.component.ts
// Sidebar universal de apresentação.
//
// Objetivos desta revisão:
// - manter o componente desacoplado de Auth/Firestore
// - suportar avatar/resumo do usuário autenticado via Input
// - melhorar acessibilidade no modo colapsado
// - melhorar UX mobile com fechamento por Escape e backdrop
// - substituir detecção manual de item ativo por routerLinkActive
//
// Observação arquitetural:
// - este componente NÃO consulta sessão diretamente
// - os dados do usuário devem vir do container/shell
// - isso evita acoplamento indevido e facilita reuso futuro
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

import type { SidebarVm } from '../../../core/services/navigation/sidebar.service';
import type {
  SidebarItem,
  SidebarSection,
} from '@core/services/navigation/sidebar-config';

export interface UniversalSidebarUserSummary {
  uid?: string | null;
  displayName: string;
  email?: string | null;
  subtitle?: string | null;
  photoURL?: string | null;
  profileRoute?: any[] | string | null;
}

@Component({
  selector: 'app-universal-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './universal-sidebar.component.html',
  styleUrls: ['./universal-sidebar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UniversalSidebarComponent {
  @Input({ required: true }) vm!: SidebarVm;

  /**
   * Resumo opcional do usuário autenticado.
   * Mantido fora do SidebarVm para não misturar:
   * - estado estrutural do menu
   * - identidade visual/contextual do usuário
   */
  @Input() user: UniversalSidebarUserSummary | null = null;

  @Output() toggleRequested = new EventEmitter<void>();
  @Output() collapseRequested = new EventEmitter<void>();

  trackSection(_: number, section: SidebarSection): string {
    return section.key;
  }

  trackItem(_: number, item: SidebarItem): string {
    return item.id;
  }

  get shouldShowExpandedContent(): boolean {
    return !this.vm?.isCollapsed || !!this.vm?.isMobile;
  }

  get avatarSrc(): string {
    return this.user?.photoURL?.trim() || 'assets/imagem-padrao.webp';
  }

  get userSecondaryText(): string | null {
    const subtitle = this.user?.subtitle?.trim();
    if (subtitle) return subtitle;

    const email = this.user?.email?.trim();
    return email || null;
  }

  onItemActivated(): void {
    if (this.vm?.isMobile && this.vm?.isOpen) {
      this.toggleRequested.emit();
    }
  }

  onBackdropClick(): void {
    if (this.vm?.isMobile && this.vm?.isOpen) {
      this.toggleRequested.emit();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    if (this.vm?.isMobile && this.vm?.isOpen) {
      this.toggleRequested.emit();
    }
  }
}
