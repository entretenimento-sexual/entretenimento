import { isSidebarGroupItem } from '@core/services/navigation/sidebar-config';
import type {
  SidebarItem,
  SidebarLinkItem,
  SidebarSection,
} from '@core/services/navigation/sidebar-config';
import type { SidebarVm } from '@core/services/navigation/sidebar.service';
import type {
  UniversalSidebarQuickAction,
  UniversalSidebarUserSummary,
} from '../../shared/components-globais/universal-sidebar/universal-sidebar.component';

export type ShellMode = 'guest' | 'onboarding' | 'auth';

export type NavbarContextAction = UniversalSidebarQuickAction;

export interface LayoutShellVm {
  currentUrl: string;
  shellMode: ShellMode;
  showSidebar: boolean;
  showFooter: boolean;
  friendRequestsCount: number;
  isChatLayout: boolean;
  sidebar: SidebarVm;
  sidebarUser: UniversalSidebarUserSummary | null;
  sidebarShouldOverlay: boolean;
  sidebarShouldCompact: boolean;
  navbarContextActions: NavbarContextAction[];
  sidebarQuickActions: UniversalSidebarQuickAction[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function areUnknownValuesEqual(previous: unknown, current: unknown): boolean {
  if (Object.is(previous, current)) return true;

  if (Array.isArray(previous) || Array.isArray(current)) {
    if (!Array.isArray(previous) || !Array.isArray(current)) return false;
    if (previous.length !== current.length) return false;

    return previous.every((value, index) =>
      areUnknownValuesEqual(value, current[index])
    );
  }

  if (!isPlainRecord(previous) || !isPlainRecord(current)) {
    return false;
  }

  const previousKeys = Object.keys(previous);
  const currentKeys = Object.keys(current);

  if (previousKeys.length !== currentKeys.length) return false;

  return previousKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(current, key) &&
      areUnknownValuesEqual(previous[key], current[key])
  );
}

function areStringArraysEqual(
  previous: readonly string[],
  current: readonly string[]
): boolean {
  if (previous === current) return true;
  if (previous.length !== current.length) return false;

  return previous.every((value, index) => value === current[index]);
}

function areSidebarLinkItemsEqual(
  previous: SidebarLinkItem,
  current: SidebarLinkItem
): boolean {
  return (
    previous.id === current.id &&
    previous.label === current.label &&
    previous.route === current.route &&
    previous.icon === current.icon &&
    previous.exact === current.exact &&
    previous.ariaLabel === current.ariaLabel &&
    previous.disabled === current.disabled &&
    previous.badgeCount === current.badgeCount &&
    previous.badgeLabel === current.badgeLabel
  );
}

function areSidebarItemsEqual(
  previous: SidebarItem,
  current: SidebarItem
): boolean {
  const previousIsGroup = isSidebarGroupItem(previous);
  const currentIsGroup = isSidebarGroupItem(current);

  if (previousIsGroup !== currentIsGroup) return false;

  if (!previousIsGroup || !currentIsGroup) {
    return areSidebarLinkItemsEqual(
      previous as SidebarLinkItem,
      current as SidebarLinkItem
    );
  }

  if (
    previous.id !== current.id ||
    previous.label !== current.label ||
    previous.icon !== current.icon ||
    previous.ariaLabel !== current.ariaLabel ||
    previous.disabled !== current.disabled ||
    previous.children.length !== current.children.length
  ) {
    return false;
  }

  return previous.children.every((child, index) =>
    areSidebarLinkItemsEqual(child, current.children[index])
  );
}

function areSidebarSectionsEqual(
  previous: readonly SidebarSection[],
  current: readonly SidebarSection[]
): boolean {
  if (previous === current) return true;
  if (previous.length !== current.length) return false;

  return previous.every((section, sectionIndex) => {
    const currentSection = current[sectionIndex];

    return (
      section.key === currentSection.key &&
      section.title === currentSection.title &&
      section.items.length === currentSection.items.length &&
      section.items.every((item, itemIndex) =>
        areSidebarItemsEqual(item, currentSection.items[itemIndex])
      )
    );
  });
}

function areSidebarVmsEqual(
  previous: SidebarVm,
  current: SidebarVm
): boolean {
  return (
    previous === current ||
    (previous.isMobile === current.isMobile &&
      previous.isOpen === current.isOpen &&
      previous.isCollapsed === current.isCollapsed &&
      previous.currentUrl === current.currentUrl &&
      previous.currentSection === current.currentSection &&
      areStringArraysEqual(
        previous.expandedGroupIds,
        current.expandedGroupIds
      ) &&
      areSidebarSectionsEqual(previous.sections, current.sections))
  );
}

function areActionsEqual(
  previous: UniversalSidebarQuickAction,
  current: UniversalSidebarQuickAction
): boolean {
  return (
    previous.id === current.id &&
    previous.label === current.label &&
    areUnknownValuesEqual(previous.route, current.route) &&
    areUnknownValuesEqual(previous.queryParams ?? null, current.queryParams ?? null) &&
    previous.icon === current.icon &&
    previous.ariaLabel === current.ariaLabel &&
    previous.variant === current.variant &&
    previous.disabled === current.disabled &&
    previous.badgeCount === current.badgeCount &&
    previous.badgeLabel === current.badgeLabel
  );
}

function areActionArraysEqual(
  previous: readonly UniversalSidebarQuickAction[],
  current: readonly UniversalSidebarQuickAction[]
): boolean {
  if (previous === current) return true;
  if (previous.length !== current.length) return false;

  return previous.every((action, index) =>
    areActionsEqual(action, current[index])
  );
}

function areSidebarUsersEqual(
  previous: UniversalSidebarUserSummary | null,
  current: UniversalSidebarUserSummary | null
): boolean {
  if (previous === current) return true;
  if (!previous || !current) return false;

  return (
    (previous.uid ?? null) === (current.uid ?? null) &&
    previous.displayName === current.displayName &&
    (previous.email ?? null) === (current.email ?? null) &&
    (previous.subtitle ?? null) === (current.subtitle ?? null) &&
    (previous.photoURL ?? null) === (current.photoURL ?? null) &&
    areUnknownValuesEqual(
      previous.profileRoute ?? null,
      current.profileRoute ?? null
    )
  );
}

export function areLayoutShellVmsEqual(
  previous: LayoutShellVm,
  current: LayoutShellVm
): boolean {
  return (
    previous === current ||
    (previous.currentUrl === current.currentUrl &&
      previous.shellMode === current.shellMode &&
      previous.showSidebar === current.showSidebar &&
      previous.showFooter === current.showFooter &&
      previous.isChatLayout === current.isChatLayout &&
      previous.friendRequestsCount === current.friendRequestsCount &&
      previous.sidebarShouldOverlay === current.sidebarShouldOverlay &&
      previous.sidebarShouldCompact === current.sidebarShouldCompact &&
      areSidebarVmsEqual(previous.sidebar, current.sidebar) &&
      areSidebarUsersEqual(previous.sidebarUser, current.sidebarUser) &&
      areActionArraysEqual(
        previous.navbarContextActions,
        current.navbarContextActions
      ) &&
      areActionArraysEqual(
        previous.sidebarQuickActions,
        current.sidebarQuickActions
      ))
  );
}
