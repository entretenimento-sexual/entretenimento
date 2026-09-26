import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityAdminTimelineRepository } from '../data-access/community-admin-timeline.repository';
import { CommunityAdminTimelineComponent } from './community-admin-timeline.component';

describe('CommunityAdminTimelineComponent', () => {
  it('renderiza evento sanitizado sem depender do audit bruto', async () => {
    const repository = {
      getPage$: vi.fn().mockReturnValue(of({
        items: [
          {
            id: 'event-1',
            category: 'membership',
            eventType: 'member_blocked',
            actor: { kind: 'user', label: 'ANA' },
            subject: { kind: 'user', label: 'BIA' },
            details: {},
            createdAt: 1_000,
          },
          {
            id: 'event-2',
            category: 'moderation',
            eventType: 'highlight_changed',
            actor: { kind: 'user', label: 'CARLA' },
            subject: null,
            details: { target: 'post', action: 'pinned' },
            createdAt: 900,
          },
        ],
        nextCursor: null,
        generatedAt: 1_100,
      })),
    };

    TestBed.configureTestingModule({
      imports: [CommunityAdminTimelineComponent],
      providers: [
        { provide: CommunityAdminTimelineRepository, useValue: repository },
        {
          provide: ApplicationErrorService,
          useValue: { report: vi.fn() },
        },
      ],
    });

    const fixture = TestBed.createComponent(CommunityAdminTimelineComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('ANA bloqueou BIA.');
    expect(fixture.nativeElement.textContent).toContain(
      'CARLA destacou uma publicação.'
    );
    expect(repository.getPage$).toHaveBeenCalledWith('community-1');
  });
});
