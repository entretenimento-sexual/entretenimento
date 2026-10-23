import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OwnerPrivateVideoViewerComponent,
} from './owner-private-video-viewer.component';

describe('OwnerPrivateVideoViewerComponent', () => {
  let fixture: ComponentFixture<OwnerPrivateVideoViewerComponent>;
  const close = vi.fn();

  beforeEach(async () => {
    close.mockReset();
    await TestBed.configureTestingModule({
      imports: [OwnerPrivateVideoViewerComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: {
          url: 'https://example.test/private.mp4?temporary=1',
          posterUrl: null,
          title: 'Vídeo do titular',
        } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OwnerPrivateVideoViewerComponent);
    fixture.detectChanges();
  });

  it('renders owner-only playback with no autoplay', () => {
    const player = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(player.hasAttribute('controls')).toBe(true);
    expect(player.hasAttribute('autoplay')).toBe(false);
    expect(player.getAttribute('src')).toContain('private.mp4?temporary=1');
    expect(fixture.nativeElement.textContent).toContain('exclusiva do proprietário');
  });

  it('shows accessible feedback when a temporary playback URL fails', () => {
    const player = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    player.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    const feedback = fixture.nativeElement.querySelector('[role="alert"]');
    expect(feedback?.textContent).toContain('solicitar um novo acesso temporário');
  });

  it('stops playback and clears the signed URL before returning to gallery', () => {
    const player = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    vi.spyOn(player, 'pause').mockImplementation(() => {});
    vi.spyOn(player, 'load').mockImplementation(() => {});
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(player.hasAttribute('src')).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });
});
