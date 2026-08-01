import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { PublicVideoMetadataPreloadService } from 'src/app/core/services/media/public-video-metadata-preload.service';
import { PublicVideoMetadataPreloadDirective } from './public-video-metadata-preload.directive';

const VIDEO = {
  id: 'video_1',
  ownerUid: 'owner_1',
} as IPublicVideoItem;

@Component({
  standalone: true,
  imports: [PublicVideoMetadataPreloadDirective],
  template: `
    <button
      type="button"
      [appPublicVideoMetadataPreload]="video"
    >
      Abrir
    </button>
  `,
})
class HostComponent {
  readonly video = VIDEO;
}

function pointerEvent(
  type: string,
  values: Partial<PointerEvent>
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });

  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, {
      configurable: true,
      value,
    });
  }

  return event as PointerEvent;
}

describe('PublicVideoMetadataPreloadDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let preloadMetadata: ReturnType<typeof vi.fn>;
  let button: HTMLButtonElement;

  beforeEach(() => {
    preloadMetadata = vi.fn(() => true);

    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: PublicVideoMetadataPreloadService,
          useValue: { preloadMetadata },
        },
      ],
    });

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button');
  });

  it('prepara ao receber foco de teclado', () => {
    button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(preloadMetadata).toHaveBeenCalledWith(VIDEO);
  });

  it('prepara em hover de mouse', () => {
    button.dispatchEvent(pointerEvent('pointerenter', {
      pointerType: 'mouse',
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }));

    expect(preloadMetadata).toHaveBeenCalledWith(VIDEO);
  });

  it('prepara toque concluído sem movimento de rolagem', () => {
    button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 30,
      clientY: 40,
    }));
    button.dispatchEvent(pointerEvent('pointerup', {
      pointerType: 'touch',
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 34,
      clientY: 44,
    }));

    expect(preloadMetadata).toHaveBeenCalledWith(VIDEO);
  });

  it('não prepara quando o toque vira rolagem', () => {
    button.dispatchEvent(pointerEvent('pointerdown', {
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 20,
    }));
    button.dispatchEvent(pointerEvent('pointermove', {
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 80,
    }));
    button.dispatchEvent(pointerEvent('pointerup', {
      pointerType: 'touch',
      pointerId: 3,
      isPrimary: true,
      button: 0,
      clientX: 20,
      clientY: 80,
    }));

    expect(preloadMetadata).not.toHaveBeenCalled();
  });
});
