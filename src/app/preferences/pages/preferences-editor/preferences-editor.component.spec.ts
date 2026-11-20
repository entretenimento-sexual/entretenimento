import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import {
  PROFILE_COMPLETED_NAVIGATION_INFO,
  REGISTRATION_COMPLETION_ROUTE,
} from '../../../register-module/data-access/register-flow.model';
import { PreferencesEditorFacade } from '../../application/preferences-editor.facade';
import { PreferencesUiService } from '../../state/preferences-ui.service';
import { PreferencesEditorComponent } from './preferences-editor.component';

@Component({ template: '<h1>Hoje</h1>' })
class TodayPageStub {}

describe('PreferencesEditorComponent após o cadastro', () => {
  let harness: RouterTestingHarness;
  let router: Router;
  const saveProfileOnly = vi.fn(() => of(void 0));

  beforeEach(async () => {
    saveProfileOnly.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter([
          { path: 'preferencias/editar', component: PreferencesEditorComponent },
          { path: 'dashboard/principal', component: TodayPageStub },
        ]),
        {
          provide: PreferencesEditorFacade,
          useValue: { currentEditorState$: of(null), saveProfileOnly$: saveProfileOnly },
        },
        { provide: PreferencesUiService, useValue: { setActiveView: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showSuccess: vi.fn() } },
      ],
    });

    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });

  it('confirma a conclusão e abre Hoje sem exigir o salvamento de preferências', async () => {
    await router.navigateByUrl(REGISTRATION_COMPLETION_ROUTE, { info: PROFILE_COMPLETED_NAVIGATION_INFO });
    harness.detectChanges();

    const welcome = harness.routeNativeElement?.querySelector('.profile-ready');
    expect(welcome?.querySelector('h2')?.textContent).toBe('Seu perfil está pronto');
    const explore = welcome?.querySelector<HTMLAnchorElement>('a');
    expect(explore?.textContent?.trim()).toBe('Explorar agora');
    expect(explore?.getAttribute('href')).toBe('/dashboard/principal');
    expect(TestBed.inject(Location).getState()).not.toHaveProperty('info');

    explore!.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/dashboard/principal');
    expect(saveProfileOnly).not.toHaveBeenCalled();

    TestBed.inject(Location).back();
    await vi.waitFor(() => expect(router.url).toBe(REGISTRATION_COMPLETION_ROUTE));
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('.profile-ready')).toBeNull();
  });

  it('abre a edição comum sem mensagem de conclusão em um acesso direto', async () => {
    await harness.navigateByUrl(REGISTRATION_COMPLETION_ROUTE, PreferencesEditorComponent);
    expect(harness.routeNativeElement?.querySelector('.profile-ready')).toBeNull();
  });
});
