import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CommunityRealtimeAttentionCoordinatorService,
  type CommunityRealtimeAttentionMode,
} from './community-realtime-attention-coordinator.service';

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

describe('CommunityRealtimeAttentionCoordinatorService', () => {
  let document: FakeDocument;
  let service: CommunityRealtimeAttentionCoordinatorService;

  beforeEach(() => {
    document = new FakeDocument();

    TestBed.configureTestingModule({
      providers: [
        CommunityRealtimeAttentionCoordinatorService,
        { provide: DOCUMENT, useValue: document },
      ],
    });

    service = TestBed.inject(CommunityRealtimeAttentionCoordinatorService);
  });

  it('mantém somente o lease mais recente em realtime detalhado', () => {
    const first: CommunityRealtimeAttentionMode[] = [];
    const second: CommunityRealtimeAttentionMode[] = [];

    const firstSubscription = service.claimMode$('community-a')
      .subscribe((mode) => first.push(mode));
    expect(first.at(-1)).toBe('detailed');

    const secondSubscription = service.claimMode$('community-b')
      .subscribe((mode) => second.push(mode));

    expect(first.at(-1)).toBe('aggregate');
    expect(second.at(-1)).toBe('detailed');

    secondSubscription.unsubscribe();

    expect(first.at(-1)).toBe('detailed');
    firstSubscription.unsubscribe();
  });

  it('força o primeiro plano para agregado quando a aba fica oculta', () => {
    const modes: CommunityRealtimeAttentionMode[] = [];
    const subscription = service.claimMode$('community-a')
      .subscribe((mode) => modes.push(mode));

    expect(modes.at(-1)).toBe('detailed');

    document.setVisibility('hidden');
    expect(modes.at(-1)).toBe('aggregate');

    document.setVisibility('visible');
    expect(modes.at(-1)).toBe('detailed');

    subscription.unsubscribe();
  });

  it('não concede realtime detalhado para identificador inválido', () => {
    const modes: CommunityRealtimeAttentionMode[] = [];
    const subscription = service.claimMode$('id com espaço')
      .subscribe((mode) => modes.push(mode));

    expect(modes).toEqual(['aggregate']);
    subscription.unsubscribe();
  });
});
