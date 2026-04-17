// src/app/shared/components-globais/universal-sidebar/universal-sidebar.component.ts
// Sidebar universal de apresentação.
//
// Objetivos desta revisão:
// - manter o componente desacoplado de Auth/Firestore
// - suportar header com avatar/resumo do usuário autenticado via Input
// - melhorar acessibilidade no modo colapsado
// - melhorar UX mobile/overlay com fechamento por Escape e backdrop
// - substituir detecção manual de item ativo por routerLinkActive
//
// Observação arquitetural:
// - este componente NÃO consulta sessão diretamente
// - os dados do usuário devem vir do container/shell
// - isso evita acoplamento indevido e facilita reuso futuro
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
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

  /**
   * Força comportamento overlay mesmo fora do mobile puro.
   * Isso permite que o shell esconda a sidebar naturalmente
   * em larguras intermediárias sem deformar o template antigo.
   */
  @Input() forceOverlay = false;
  @Input() forceCollapsed = false;

  @Output() toggleRequested = new EventEmitter<void>();
  @Output() collapseRequested = new EventEmitter<void>();

  @ViewChild('sidebarRoot', { read: ElementRef })
  private sidebarRoot?: ElementRef<HTMLElement>;

  trackSection(_: number, section: SidebarSection): string {
    return section.key;
  }

  trackItem(_: number, item: SidebarItem): string {
    return item.id;
  }

get isOverlayMode(): boolean {
  return this.forceOverlay;
}

get isCollapsedMode(): boolean {
  if (this.isOverlayMode) {
    return false;
  }

  return !!this.forceCollapsed || !!this.vm?.isCollapsed;
}

get shouldShowExpandedContent(): boolean {
  return !this.isCollapsedMode;
}

get shouldShowDesktopCollapseButton(): boolean {
  return !this.isOverlayMode;
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
    if (this.isOverlayMode && this.vm?.isOpen) {
      this.closeOverlaySidebar();
    }
  }

  onBackdropClick(): void {
    if (this.isOverlayMode && this.vm?.isOpen) {
      this.closeOverlaySidebar();
    }
  }

  onCloseButtonClick(): void {
    if (this.isOverlayMode && this.vm?.isOpen) {
      this.closeOverlaySidebar();
    }
  }

  private closeOverlaySidebar(): void {
    this.blurFocusedElementInsideSidebar();
    this.toggleRequested.emit();
  }

  private blurFocusedElementInsideSidebar(): void {
    const sidebarEl = this.sidebarRoot?.nativeElement;
    const activeEl = document.activeElement as HTMLElement | null;

    if (!sidebarEl || !activeEl) {
      return;
    }

    if (sidebarEl.contains(activeEl) && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    if (this.isOverlayMode && this.vm?.isOpen) {
      this.closeOverlaySidebar();
    }
  }
}