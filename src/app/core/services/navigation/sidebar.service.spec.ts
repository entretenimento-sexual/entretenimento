import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { SidebarService, type SidebarVm } from './sidebar.service';

describe('SidebarService groups', () => {
  function createService(): SidebarService {
    const breakpointObserver = {
      observe: vi.fn(() => of({ matches: false })),
    };
    const routeContext = {
      currentUrl$: of('/dashboard/principal'),
    };
    const access = {
      isSubscriber$: of(false),
      hasAny$: vi.fn(() => of(false)),
    };
    const globalErrorHandler = {
      handleError: vi.fn(),
    };

    return new SidebarService(
      breakpointObserver as any,
      routeContext as any,
      access as any,
      globalErrorHandler as any
    );
  }

  it('abre, fecha e alterna grupos sem duplicar IDs', () => {
    const service = createService();
    const emissions: readonly string[][] = [];
    const subscription = service.expandedGroupIds$.subscribe((value) => {
      (emissions as string[][]).push([...value]);
    });

    service.openGroup(' account ');
    service.openGroup('account');
    expect(emissions.at(-1)).toEqual(['account']);

    service.toggleGroup('account');
    expect(emissions.at(-1)).toEqual([]);

    service.toggleGroup('account');
    expect(emissions.at(-1)).toEqual(['account']);

    service.closeGroup('account');
    expect(emissions.at(-1)).toEqual([]);

    service.openGroup('   ');
    expect(emissions.at(-1)).toEqual([]);

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
});
