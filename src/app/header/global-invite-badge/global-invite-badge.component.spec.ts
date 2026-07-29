// src/app/header/global-invite-badge/global-invite-badge.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import {
  selectInviteOwnerUid,
  selectPendingInvitesCount,
} from 'src/app/store/selectors/selectors.chat/invite.selectors';
import { GlobalInviteBadgeComponent } from './global-invite-badge.component';

describe('GlobalInviteBadgeComponent room session ownership', () => {
  let fixture: ComponentFixture<GlobalInviteBadgeComponent>;
  let store: MockStore;
  let uidSubject: BehaviorSubject<string | null>;

  beforeEach(async () => {
    uidSubject = new BehaviorSubject<string | null>('user-a');

    await TestBed.configureTestingModule({
      imports: [GlobalInviteBadgeComponent],
      providers: [
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectInviteOwnerUid, value: 'user-a' },
            { selector: selectPendingInvitesCount, value: 4 },
          ],
        }),
        {
          provide: AuthSessionService,
          useValue: { uid$: uidSubject.asObservable() },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(GlobalInviteBadgeComponent);
    fixture.detectChanges();
  });

  it('exibe somente a contagem pertencente ao UID atual', async () => {
    const vm = await firstValueFrom(fixture.componentInstance.vm$);

    expect(vm).toMatchObject({
      count: 4,
      countLabel: '4',
      visible: true,
    });
  });

  it('navega para o inbox canônico de convites para salas', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(link?.textContent).toContain('Convites para salas');
    expect(link?.getAttribute('href')).toBe('/chat/room-invites');
  });

  it('zera imediatamente quando a sessão muda antes do novo owner', async () => {
    uidSubject.next('user-b');

    const vm = await firstValueFrom(fixture.componentInstance.vm$);
    fixture.detectChanges();

    expect(vm.count).toBe(0);
    expect(vm.visible).toBe(false);
    expect(fixture.nativeElement.querySelector('a')).toBeNull();
  });

  it('volta a exibir quando Store e sessão pertencem ao mesmo UID', async () => {
    uidSubject.next('user-b');
    store.overrideSelector(selectInviteOwnerUid, 'user-b');
    store.overrideSelector(selectPendingInvitesCount, 2);
    store.refreshState();
    fixture.detectChanges();

    const vm = await firstValueFrom(fixture.componentInstance.vm$);

    expect(vm.count).toBe(2);
    expect(vm.visible).toBe(true);
  });
});
