// src/app/messaging/direct-chat/presentation/direct-chat-public-identity.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { DirectChatFacade } from '../application/direct-chat.facade';
import { DirectChatPublicIdentityComponent } from './direct-chat-public-identity.component';

describe('DirectChatPublicIdentityComponent', () => {
  it('renderiza a identidade pública canônica da conversa selecionada', async () => {
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
                  discoveryGroup: 'woman',
                  city: 'Rio de Janeiro',
                  state: 'RJ',
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

    expect(text).toContain('serale');
    expect(text).toContain('Mulher');
    expect(text).toContain('Rio de Janeiro/RJ');
    expect(text).toContain('Conversa direta');
  });

  it('preserva fallback visual enquanto a identidade enriquecida ainda não chegou', async () => {
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
  });
});
