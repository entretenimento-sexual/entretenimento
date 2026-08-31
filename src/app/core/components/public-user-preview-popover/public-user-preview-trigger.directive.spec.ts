import { OverlayContainer } from '@angular/cdk/overlay';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';

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
    >
      Perfil
    </button>
  `,
})
class PreviewTriggerHostComponent {
  preview: PublicUserPreview | null = {
    identity: {
      profileId: 'user-1',
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
    age: 31,
    orientationLabel: 'bissexual',
    isOnline: false,
    approximateDistanceKm: 3.4,
    bioPreview: 'Bio pública.',
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

    expect(directive.isOpen()).toBe(true);
    expect(
      overlayContainer.getContainerElement().querySelector(
        'app-public-user-preview-popover'
      )
    ).toBeTruthy();

    directive.close();
    fixture.detectChanges();

    expect(directive.isOpen()).toBe(false);
    expect(
      overlayContainer.getContainerElement().querySelector(
        'app-public-user-preview-popover'
      )
    ).toBeNull();
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
