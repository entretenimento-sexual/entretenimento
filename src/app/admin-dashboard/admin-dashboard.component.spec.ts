import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

import { AuthSessionService } from '../core/services/autentication/auth/auth-session.service';
import { AdminPrivilegeWatchService } from './admin-privilege-watch.service';
import { AdminDashboardComponent } from './admin-dashboard.component';

describe('AdminDashboardComponent / revogação ativa', () => {
  let session: BehaviorSubject<{ uid: string } | null>;
  let streams: Map<string, Subject<boolean>>;
  let terminated: string[];
  let watch: jasmine.Spy;
  let navigate: jasmine.Spy;

  beforeEach(async () => {
    session = new BehaviorSubject<{ uid: string } | null>({ uid: 'admin-one' });
    streams = new Map();
    terminated = [];
    watch = jasmine.createSpy('watch').and.callFake((uid: string) =>
      new Observable<boolean>((observer) => {
        let source = streams.get(uid);
        if (!source) {
          source = new Subject<boolean>();
          streams.set(uid, source);
        }
        const subscription = source.subscribe(observer);
        return () => {
          terminated.push(uid);
          subscription.unsubscribe();
        };
      })
    );
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);

    await TestBed.configureTestingModule({
      declarations: [AdminDashboardComponent],
      providers: [
        { provide: AuthSessionService, useValue: { authUser$: session.asObservable() } },
        { provide: AdminPrivilegeWatchService, useValue: { watch } },
        { provide: Router, useValue: { navigate } },
      ],
    })
      .overrideComponent(AdminDashboardComponent, { set: { template: '' } })
      .compileComponents();
  });

  function mount() {
    const fixture = TestBed.createComponent(AdminDashboardComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('sai ao receber revogação com página aberta', () => {
    const fixture = mount();
    streams.get('admin-one')!.next(true);
    expect(navigate).not.toHaveBeenCalled();
    streams.get('admin-one')!.next(false);
    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    expect(terminated).toContain('admin-one');
    fixture.destroy();
  });

  it('sai ao receber indisponibilidade do servidor (snapshot de cache traduzido em false)', () => {
    const fixture = mount();
    streams.get('admin-one')!.next(false);
    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    fixture.destroy();
  });

  it('sai ao receber erro de listener', () => {
    const fixture = mount();
    streams.get('admin-one')!.error(new Error('firestore unavailable'));
    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    fixture.destroy();
  });

  it('troca a inscrição quando muda o usuário e descarta no destroy', () => {
    const fixture = mount();
    session.next({ uid: 'admin-two' });
    expect(watch).toHaveBeenCalledWith('admin-two');
    expect(terminated).toContain('admin-one');
    fixture.destroy();
    expect(terminated).toContain('admin-two');
    streams.get('admin-two')!.next(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('desliga a área na perda de autenticação sem navegar repetidamente', () => {
    const fixture = mount();
    session.next(null);
    session.next({ uid: 'admin-two' });
    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    expect(watch).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('não multiplica navegações quando ocorrem eventos de revogação sucessivos', () => {
    const fixture = mount();
    streams.get('admin-one')!.next(false);
    streams.get('admin-one')!.next(false);
    expect(navigate).toHaveBeenCalledOnceWith(['/dashboard']);
    fixture.destroy();
  });
});
