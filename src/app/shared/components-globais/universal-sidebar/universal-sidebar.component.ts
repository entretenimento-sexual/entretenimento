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
// Ajustes desta versão:
// - adiciona lockCollapsed para o modo chat
// - suprime perfil expandido e quick actions quando o rail estiver travado
// - impede expansão manual do sidebar no modo chat
// - adiciona fallback visual quando avatar remoto falhar
// - suporta grupos e submenus controlados pelo SidebarService
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
import {
  isSidebarGroupItem,
  type SidebarGroupItem,
  type SidebarItem,
  type SidebarLinkItem,
  type SidebarSection,
} from '@core/services/navigation/sidebar-config';

export interface UniversalSidebarUserSummary {
  uid?: string | null;
  displayName: string;
  email?: string | null;
  subtitle?: string | null;
  photoURL?: string | null;
  profileRoute?: any[] | string | null;
}

export interface UniversalSidebarQuickAction {
  id: string;
  label: string;
  route: any[] | string;
  queryParams?: Record<string, string> | null;
  icon?: string | null;
  ariaLabel?: string | null;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  badgeCount?: number | null;
  badgeLabel?: string | null;
}

@Component({
  selector: 'app-universal-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './universal-sidebar.component.html',
  styleUrls: [
    './universal-sidebar.component.css',
    './universal-sidebar-groups.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UniversalSidebarComponent {
  @Input({ required: true }) vm!: SidebarVm;

  /**
   * Resumo opcional do usuário autenticado.
   * Mantido desacoplado do estado estrutural do menu.
   */
  @Input() user: UniversalSidebarUserSummary | null = null;

  /**
   * Ações rápidas opcionais vindas do shell.
   * O componente apenas renderiza; não decide regra de negócio.
   */
  @Input() quickActions: UniversalSidebarQuickAction[] = [];

  @Input() forceOverlay = false;
  @Input() forceCollapsed = false;

  /**
   * Quando true:
   * - sidebar fica permanentemente recolhido
   * - botão de expandir/recolher some
   * - perfil expandido e quick actions são suprimidos
   *
   * Uso principal:
   * - modo chat
   */
  @Input() lockCollapsed = false;

  @Output() toggleRequested = new EventEmitter<void>();
  @Output() collapseRequested = new EventEmitter<void>();
  @Output() groupToggleRequested = new EventEmitter<string>();
  @Output() groupCloseRequested = new EventEmitter<string>();

  @ViewChild('sidebarRoot', { read: ElementRef })
  private sidebarRoot?: ElementRef<HTMLElement>;

  private readonly fallbackAvatarSrc = 'assets/imagem-padrao.webp';

  trackSection(_: number, section: SidebarSection): string {
    return section.key;
  }

  trackItem(_: number, item: SidebarItem): string {
    return item.id;
  }

  trackChild(_: number, item: SidebarLinkItem): string {
    return item.id;
  }

  trackQuickAction(_: number, action: UniversalSidebarQuickAction): string {
    return action.id;
  }

  isGroupItem(item: SidebarItem): item is SidebarGroupItem {
    return isSidebarGroupItem(item);
  }

  asLinkItem(item: SidebarItem): SidebarLinkItem | null {
    return isSidebarGroupItem(item) ? null : item;
  }

  isGroupExpanded(group: SidebarGroupItem): boolean {
    const explicitlyExpanded = this.vm?.expandedGroupIds?.includes(group.id) === true;

    if (this.isCollapsedMode) {
      return explicitlyExpanded;
    }

    return explicitlyExpanded || this.isGroupActive(group);
  }

  isGroupActive(group: SidebarGroupItem): boolean {
    return group.children.some((child) => this.isLinkActive(child));
  }

  isLinkActive(item: SidebarLinkItem): boolean {
    const currentUrl = this.normalizeUrl(this.vm?.currentUrl);
    const route = this.normalizeUrl(item.route);

    if (!route) return false;
    if (item.exact === true) return currentUrl === route;

    return currentUrl === route || currentUrl.startsWith(`${route}/`);
  }

  groupPanelId(groupId: string): string {
    const safeId = String(groupId ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-');

    return `sidebar-group-${safeId || 'menu'}`;
  }

  formatBadgeCount(count: number | null | undefined): string {
    const safeCount = Number(count ?? 0);

    if (!Number.isFinite(safeCount) || safeCount <= 0) {
      return '';
    }

    return safeCount > 99 ? '99+' : String(safeCount);
  }

  hasBadge(count: number | null | undefined): boolean {
    const safeCount = Number(count ?? 0);
    return Number.isFinite(safeCount) && safeCount > 0;
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
    return !this.isOverlayMode && !this.lockCollapsed;
  }

  get shouldShowUserBlock(): boolean {
    return !(this.lockCollapsed && this.isCollapsedMode);
  }

  get shouldShowQuickActionsBlock(): boolean {
    return !(this.lockCollapsed && this.isCollapsedMode);
  }

  get avatarSrc(): string {
    return this.user?.photoURL?.trim() || this.fallbackAvatarSrc;
  }

  get userSecondaryText(): string | null {
    const subtitle = this.user?.subtitle?.trim();
    if (subtitle) return subtitle;

    const email = this.user?.email?.trim();
    return email || null;
  }

  onAvatarError(event: Event): void {
    const image = event.target as HTMLImageElement | null;

    if (!image || image.src.endsWith(this.fallbackAvatarSrc)) {
      return;
    }

    image.src = this.fallbackAvatarSrc;
  }

  onGroupToggle(group: SidebarGroupItem): void {
    if (group.disabled) return;
    this.groupToggleRequested.emit(group.id);
  }

  onChildActivated(groupId: string): void {
    this.groupCloseRequested.emit(groupId);
    this.onItemActivated();
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

  onCollapseButtonClick(): void {
    if (this.lockCollapsed) {
      return;
    }

    this.collapseRequested.emit();
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

  private normalizeUrl(url: string | null | undefined): string {
    const clean = String(url ?? '').trim().split('?')[0].split('#')[0];

    if (!clean || clean === '/') return clean;
    return clean.endsWith('/') ? clean.slice(0, -1) : clean;
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    const expandedGroupIds = this.vm?.expandedGroupIds ?? [];
    const expandedGroupId = expandedGroupIds.length > 0
      ? expandedGroupIds[expandedGroupIds.length - 1]
      : undefined;

    if (expandedGroupId) {
      this.groupCloseRequested.emit(expandedGroupId);
      return;
    }

    if (this.isOverlayMode && this.vm?.isOpen) {
      this.closeOverlaySidebar();
    }
  }
}
