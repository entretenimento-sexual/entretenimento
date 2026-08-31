// src/app/messaging/direct-chat/presentation/direct-chat-public-identity.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DirectChatFacade } from '../application/direct-chat.facade';
import { DirectChatPublicIdentityComponent } from './direct-chat-public-identity.component';

describe('DirectChatPublicIdentityComponent', () => {
  it('renderiza a identidade pública e expõe a prévia canônica da conversa selecionada', async () => {
    await TestBed.configureTestingModule({
      imports: [DirectChatPublicIdentityComponent],
      providers: [
        {
          provide: DirectChatFacade,
          useValue: {
            items$: of([
              {
                id: 'chat-1',
                otherParticipantUid: 'u2',
                otherParticipantNickname: 'serale',
                otherParticipantPhotoURL: 'https://example.com/avatar.jpg',
                otherParticipantIdentity: {
                  profileId: 'u2',
                  nickname: 'serale',
                  label: 'serale',
                  avatarUrl: 'https://example.com/avatar.jpg',
                  identityShortLabel: 'Mulher',
                  discoveryGroup: 'woman',
                  city: 'Rio de Janeiro',
                  state: 'RJ',
                },
                otherParticipantPreview: {
                  identity: {
                    profileId: 'u2',
                    nickname: 'serale',
                    label: 'serale',
                    avatarUrl: 'https://example.com/avatar.jpg',
                    identityShortLabel: 'Mulher',
                    discoveryGroup: 'woman',
                    city: 'Rio de Janeiro',
                    state: 'RJ',
                  },
                  age: 31,
                  orientationLabel: 'bissexual',
                  isOnline: true,
                  approximateDistanceKm: null,
                  bioPreview: 'Bio pública.',
                  highlights: ['Amizade'],
                },
              },
            ]),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DirectChatPublicIdentityComponent);
    fixture.componentRef.setInput('chatId', 'chat-1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const previewButton = fixture.nativeElement.querySelector(
      '.direct-chat-public-identity__preview'
    ) as HTMLButtonElement | null;

    expect(text).toContain('serale');
    expect(text).toContain('Mulher');
    expect(text).toContain('Rio de Janeiro/RJ');
    expect(text).toContain('Conversa direta');
    expect(previewButton).toBeTruthy();
    expect(previewButton?.getAttribute('aria-label')).toContain('serale');
  });

  it('preserva fallback visual sem expor controle de prévia enquanto o perfil público não chegou', async () => {
    await TestBed.resetTestingModule().configureTestingModule({
      imports: [DirectChatPublicIdentityComponent],
      providers: [
        {
          provide: DirectChatFacade,
          useValue: { items$: of([]) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DirectChatPublicIdentityComponent);
    fixture.componentRef.setInput('chatId', 'chat-legacy');
    fixture.componentRef.setInput('fallbackName', 'Contato');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(text).toContain('Contato');
    expect(text).toContain('Conversa direta');
    expect(
      fixture.nativeElement.querySelector('.direct-chat-public-identity__preview')
    ).toBeNull();
  });
});
