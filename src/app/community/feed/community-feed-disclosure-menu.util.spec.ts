import { describe, expect, it, vi } from 'vitest';

import {
  dismissOpenCommunityFeedDetailsOnEscape,
  dismissOpenCommunityFeedDetailsOutside,
} from './community-feed-disclosure-menu.util';

function createMenu(label: string): HTMLDetailsElement {
  const menu = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = label;
  const action = document.createElement('button');
  action.textContent = 'Ação';
  menu.append(summary, action);
  document.body.append(menu);
  return menu;
}

describe('community feed disclosure menu dismiss', () => {
  it('fecha menus abertos ao clicar fora e preserva o menu que contém o alvo', () => {
    const first = createMenu('Primeiro');
    const second = createMenu('Segundo');
    first.open = true;
    second.open = true;

    const secondAction = second.querySelector('button') as HTMLButtonElement;
    dismissOpenCommunityFeedDetailsOutside([first, second], secondAction);

    expect(first.open).toBe(false);
    expect(second.open).toBe(true);

    first.remove();
    second.remove();
  });

  it('fecha todos os menus com Escape e devolve foco ao summary do menu ativo', () => {
    const first = createMenu('Primeiro');
    const second = createMenu('Segundo');
    first.open = true;
    second.open = true;
    const action = second.querySelector('button') as HTMLButtonElement;
    const summary = second.querySelector('summary') as HTMLElement;
    const focusSpy = vi.spyOn(summary, 'focus');
    action.focus();

    const dismissed = dismissOpenCommunityFeedDetailsOnEscape(
      [first, second],
      document.activeElement
    );

    expect(dismissed).toBe(true);
    expect(first.open).toBe(false);
    expect(second.open).toBe(false);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    first.remove();
    second.remove();
  });

  it('não altera estado quando nenhum menu está aberto', () => {
    const menu = createMenu('Fechado');

    expect(dismissOpenCommunityFeedDetailsOnEscape([menu], document.body)).toBe(false);

    menu.remove();
  });
});
