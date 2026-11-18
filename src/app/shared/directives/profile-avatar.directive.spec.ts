import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAvatarReadService } from 'src/app/core/services/image-handling/profile-avatar-read.service';
import { ProfileAvatarDirective } from './profile-avatar.directive';

const PATH = 'users/test-user/published/avatar/avatar-123.jpg';
const REFERENCE = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/' +
  encodeURIComponent(PATH);
const DEFAULT_AVATAR = 'assets/imagem-padrao.webp';

@Component({
  standalone: true,
  imports: [ProfileAvatarDirective],
  template: '<img [appProfileAvatar]="source" alt="Foto de perfil" />',
})
class HostComponent {
  source = REFERENCE + '?alt=media&token=old-token';
}

describe('ProfileAvatarDirective', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
  });

  it('lê o objeto pela sessão sem aplicar o token legado à imagem', () => {
    const avatar = new BehaviorSubject<Blob | null>(null);
    const read$ = vi.fn(() => avatar);
    const createObjectURL = vi.fn(() => 'blob:test-avatar');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: ProfileAvatarReadService, useValue: { read$ } }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    const image: HTMLImageElement = fixture.nativeElement.querySelector('img');

    fixture.detectChanges();
    expect(read$).toHaveBeenCalledWith({ bucket: 'demo.appspot.com', path: PATH });
    expect(image.getAttribute('src')).toBe(DEFAULT_AVATAR);

    const bytes = new Blob(['avatar'], { type: 'image/webp' });
    avatar.next(bytes);
    fixture.detectChanges();
    expect(createObjectURL).toHaveBeenCalledWith(bytes);
    expect(image.getAttribute('src')).toBe('blob:test-avatar');

    avatar.next(null);
    fixture.detectChanges();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-avatar');
    expect(image.getAttribute('src')).toBe(DEFAULT_AVATAR);
  });

  it('preserva as URLs externas usadas por avatares de provedores de identidade', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.source = 'https://images.example.test/avatar.jpg';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src'))
      .toBe(fixture.componentInstance.source);
  });
});
