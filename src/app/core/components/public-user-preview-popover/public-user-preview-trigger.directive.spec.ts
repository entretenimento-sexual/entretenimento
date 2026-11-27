import { OverlayContainer } from '@angular/cdk/overlay';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { vi } from 'vitest';

import type { PublicUserPreview } from '../../domain/public-user-preview/public-user-preview.model';
import { PublicUserPreviewTriggerDirective } from './public-user-preview-trigger.directive';

@Component({
  standalone: true,
  imports: [PublicUserPreviewTriggerDirective],
  template: `
    <button
      type="button"
      [appPublicUserPreviewTrigger]="preview"
      [publicUserPreviewRelationship]="'Vocês estão conectados'"
      [publicUserPreviewOpenOnHover]="openOnHover"
      [publicUserPreviewProfileRoute]="['/perfil', 'user-public-1']"
    >
      Perfil
    </button>
  `,
})
class PreviewTriggerHostComponent {
  openOnHover = true;
  preview: PublicUserPreview | null = {
    identity: {
      profileId: null,
      nickname: 'serale',
      label: 'serale',
      avatarUrl: null,
      identityCode: 'mulher',
      identityShortLabel: 'Mulher',
      discoveryGroup: 'woman',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'woman',
      profileTypeLabel: 'Mulher',
    },
    isOnline: false,
    approximateDistanceKm: 3.4,
    bioPreview: 'Bio pública.',
    highlights: ['Amizade'],
  };
}

describe('PublicUserPreviewTriggerDirective', () => {
  let fixture: ComponentFixture<PreviewTriggerHostComponent>;
  let overlayContainer: OverlayContainer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        PreviewTriggerHostComponent,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PreviewTriggerHostComponent);
    overlayContainer = TestBed.inject(OverlayContainer);
    fixture.detectChanges();
  });

  afterEach(() => {
    overlayContainer.ngOnDestroy();
  });

  it('abre e fecha a prévia pelo mesmo gatilho canônico', () => {
    const debugElement = fixture.debugElement.query(
      By.directive(PublicUserPreviewTriggerDirective)
    );
    const directive = debugElement.injector.get(
      PublicUserPreviewTriggerDirective
    );

    directive.open();
    fixture.detectChanges();

    const overlay = overlayContainer.getContainerElement();
    const profileLink = overlay.querySelector(
      '.public-user-preview__profile-link'
    ) as HTMLAnchorElement | null;

    expect(directive.isOpen()).toBe(true);
    expect(
      overlay.querySelector('app-public-user-preview-popover')
    ).toBeTruthy();
    expect(profileLink?.getAttribute('href')).toContain('/perfil/user-public-1');
    expect(overlay.textContent).not.toContain('31 anos');
    expect(overlay.textContent).not.toContain('Bissexual');

    directive.close();
    fixture.detectChanges();

    expect(directive.isOpen()).toBe(false);
    expect(
      overlayContainer.getContainerElement().querySelector(
        'app-public-user-preview-popover'
      )
    ).toBeNull();
  });

  it('preserva a abertura automática por hover nos consumidores existentes', () => {
    vi.useFakeTimers();
    const directive = fixture.debugElement.query(
      By.directive(PublicUserPreviewTriggerDirective)
    ).injector.get(PublicUserPreviewTriggerDirective);
    try {
      directive.onPointerEnter({ pointerType: 'mouse' } as PointerEvent);
      vi.advanceTimersByTime(340);
      expect(directive.isOpen()).toBe(true);
      directive.onPointerLeave();
      vi.advanceTimersByTime(180);
      expect(directive.isOpen()).toBe(false);
    } finally {
      directive.close();
      vi.useRealTimers();
    }
  });

  it('permite abertura explícita sem hover e sem fechar pela saída do gatilho', () => {
    vi.useFakeTimers();
    fixture.componentInstance.openOnHover = false;
    fixture.detectChanges();
    const directive = fixture.debugElement.query(
      By.directive(PublicUserPreviewTriggerDirective)
    ).injector.get(PublicUserPreviewTriggerDirective);
    try {
      directive.onPointerEnter({ pointerType: 'mouse' } as PointerEvent);
      vi.advanceTimersByTime(500);
      expect(directive.isOpen()).toBe(false);
      directive.toggle();
      expect(directive.isOpen()).toBe(true);
      directive.onPointerLeave();
      vi.advanceTimersByTime(500);
      expect(directive.isOpen()).toBe(true);
      directive.toggle();
      expect(directive.isOpen()).toBe(false);
    } finally {
      directive.close();
      vi.useRealTimers();
    }
  });

  it('não injeta classes visuais órfãs no painel do overlay', () => {
    const directive = fixture.debugElement.query(
      By.directive(PublicUserPreviewTriggerDirective)
    ).injector.get(PublicUserPreviewTriggerDirective);

    directive.open();
    fixture.detectChanges();

    const pane = overlayContainer.getContainerElement().querySelector(
      '.cdk-overlay-pane'
    ) as HTMLElement | null;

    expect(pane).toBeTruthy();
    expect(pane?.classList.contains('public-user-preview-overlay--desktop')).toBe(false);
    expect(pane?.classList.contains('public-user-preview-overlay--touch')).toBe(false);
  });

  it('não abre overlay quando não existe identidade pública válida', () => {
    fixture.componentInstance.preview = null;
    fixture.detectChanges();

    const directive = fixture.debugElement.query(
      By.directive(PublicUserPreviewTriggerDirective)
    ).injector.get(PublicUserPreviewTriggerDirective);

    directive.open();

    expect(directive.isOpen()).toBe(false);
    expect(
      overlayContainer.getContainerElement().querySelector(
        'app-public-user-preview-popover'
      )
    ).toBeNull();
  });
});
