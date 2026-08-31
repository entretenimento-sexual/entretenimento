// src/app/community/feed/community-feed-disclosure-menu.util.ts
// -----------------------------------------------------------------------------
// Light-dismiss local dos disclosures do Mural.
// Mantém a implementação baseada em <details>, mas acrescenta o comportamento
// convencional de menus: clique/toque externo fecha e Escape fecha restaurando
// o foco no <summary> que abriu o menu.
// -----------------------------------------------------------------------------

export function dismissOpenCommunityFeedDetailsOutside(
  menus: readonly HTMLDetailsElement[],
  target: EventTarget | null
): void {
  if (!(target instanceof Node)) return;

  for (const menu of menus) {
    if (menu.open && !menu.contains(target)) {
      menu.open = false;
    }
  }
}

export function dismissOpenCommunityFeedDetailsOnEscape(
  menus: readonly HTMLDetailsElement[],
  activeElement: Element | null
): boolean {
  const openMenus = menus.filter((menu) => menu.open);
  if (openMenus.length === 0) return false;

  const activeNode = activeElement instanceof Node ? activeElement : null;
  const focusMenu = activeNode
    ? openMenus.find((menu) => menu.contains(activeNode)) ?? openMenus.at(-1)
    : openMenus.at(-1);

  for (const menu of openMenus) {
    menu.open = false;
  }

  const summary = focusMenu?.querySelector('summary');
  if (summary instanceof HTMLElement) {
    summary.focus({ preventScroll: true });
  }

  return true;
}
