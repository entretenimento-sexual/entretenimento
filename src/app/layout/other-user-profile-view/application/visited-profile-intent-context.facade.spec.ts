import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { VisitedProfileIntentContextFacade } from './visited-profile-intent-context.facade';

describe('VisitedProfileIntentContextFacade', () => {
  function setup(input?: {
    viewerStatus?: any;
    targetStatuses?: any[];
  }) {
    const watchCurrentStatus$ = vi.fn(() => of(input?.viewerStatus ?? null));
    const watchActiveStatusesForRegion$ = vi.fn(() =>
      of(input?.targetStatuses ?? [])
    );
    const watchActiveStatusesForUserRegion$ = vi.fn(() =>
      of(input?.targetStatuses ?? [])
    );

    const facade = new VisitedProfileIntentContextFacade({
      watchCurrentStatus$,
      watchActiveStatusesForRegion$,
      watchActiveStatusesForUserRegion$,
    } as any);

    return {
      facade,
      watchCurrentStatus$,
      watchActiveStatusesForRegion$,
      watchActiveStatusesForUserRegion$,
    };
  }

  it('retorna status simultâneo quando ambos estão disponíveis agora', async () => {
    const { facade, watchActiveStatusesForRegion$ } = setup({
      viewerStatus: {
        isActive: true,
        availability: 'available_now',
        destination: { region: 'rj' },
      },
      targetStatuses: [
        {
          isActive: true,
          availability: 'available_now',
        },
      ],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      title: 'Vocês estão disponíveis agora',
      detail: 'Status temporário em comum',
    });

    expect(watchActiveStatusesForRegion$).toHaveBeenCalledWith('rj', {
      limit: 1,
      ownerUids: ['target'],
    });
  });

  it('mapeia disponibilidade individual do target', async () => {
    const { facade } = setup({
      viewerStatus: {
        isActive: true,
        availability: 'available_today',
        destination: { region: 'rj' },
      },
      targetStatuses: [
        {
          isActive: true,
          availability: 'planning_later',
        },
      ],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      title: 'Planejando mais tarde',
      detail: 'Status temporário',
    });
  });

  it('usa a região canônica do usuário quando viewer não tem status ativo', async () => {
    const { facade, watchActiveStatusesForUserRegion$ } = setup({
      viewerStatus: null,
      targetStatuses: [
        {
          isActive: true,
          availability: 'available_today',
        },
      ],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toEqual({
      title: 'Disponível hoje',
      detail: 'Status temporário',
    });

    expect(watchActiveStatusesForUserRegion$).toHaveBeenCalledWith(
      'viewer',
      {
        limit: 1,
        ownerUids: ['target'],
      }
    );
  });

  it('retorna null para target sem status ativo ou perfil próprio', async () => {
    const { facade, watchCurrentStatus$ } = setup({
      targetStatuses: [],
    });

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('target')))
    ).resolves.toBeNull();

    await expect(
      firstValueFrom(facade.observe$(of('viewer'), of('viewer')))
    ).resolves.toBeNull();

    expect(watchCurrentStatus$).toHaveBeenCalledTimes(1);
  });
});
