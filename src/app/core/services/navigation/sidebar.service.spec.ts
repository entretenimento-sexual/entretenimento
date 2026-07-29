import { BehaviorSubject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { isSidebarGroupItem } from './sidebar-config';
import { SidebarService, type SidebarVm } from './sidebar.service';

function createService(): SidebarService {
  const router = {
    url: '/dashboard/principal',
    events: new BehaviorSubject<unknown>(null),
  } as never;

  return new SidebarService(router);
}

describe('SidebarService groups', () => {
  it('inicia sem grupos expandidos', () => {
    const service = createService();
    const emissions: SidebarVm[] = [];
    const subscription = service.vm$.subscribe((value) => emissions.push(value));

    expect(emissions.at(-1)?.expandedGroupIds).toEqual([]);

    subscription.unsubscribe();
  });

  it('alterna e fecha grupos explicitamente', () => {
    const service = createService();
    const emissions: SidebarVm[] = [];
    const subscription = service.vm$.subscribe((value) => emissions.push(value));

    service.toggleGroup('account');
    expect(emissions.at(-1)?.expandedGroupIds).toEqual(['account']);

    service.toggleGroup('account');
    expect(emissions.at(-1)?.expandedGroupIds).toEqual([]);

    service.openGroup('account');
    service.closeGroup('account');
    expect(emissions.at(-1)?.expandedGroupIds).toEqual([]);

    subscription.unsubscribe();
  });

  it('propaga o grupo aberto pela view model reativa', () => {
    const service = createService();
    const emissions: SidebarVm[] = [];
    const subscription = service.vm$.subscribe((value) => emissions.push(value));

    service.openGroup('account');

    expect(emissions.at(-1)?.expandedGroupIds).toEqual(['account']);
    expect(emissions.at(-1)?.sections.length).toBeGreaterThan(0);

    subscription.unsubscribe();
  });

  it('expõe Assinatura e conformidade somente dentro do grupo Conta', () => {
    const service = createService();
    const emissions: SidebarVm[] = [];
    const subscription = service.vm$.subscribe((value) => emissions.push(value));
    const sections = emissions.at(-1)?.sections ?? [];
    const settings = sections.find(({ key }) => key === 'settings');
    const account = settings?.items.find(({ id }) => id === 'account');

    expect(account && isSidebarGroupItem(account)).toBe(true);

    if (!account || !isSidebarGroupItem(account)) {
      throw new Error('Grupo Conta não foi exposto pelo SidebarService.');
    }

    expect(account.children.map(({ id }) => id)).toEqual([
      'my-profile',
      'preferences',
      'my-account',
      'compliance-cases',
      'subscription-plan',
      'safety-center',
    ]);
    expect(sections.some(({ key }) => key === 'subscriptions')).toBe(false);

    subscription.unsubscribe();
  });
});
