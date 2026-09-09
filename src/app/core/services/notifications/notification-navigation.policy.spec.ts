import { describe, expect, it } from 'vitest';

import {
  normalizeNotificationRoute,
  resolveNotificationRoute,
} from './notification-navigation.policy';

describe('normalizeNotificationRoute', () => {
  it('preserva rota interna com query e fragmento', () => {
    expect(
      normalizeNotificationRoute('/comunidades/abc/post/123?origem=push#comentario')
    ).toBe('/comunidades/abc/post/123?origem=push#comentario');
  });

  it('normaliza segmentos internos sem permitir troca de origem', () => {
    expect(normalizeNotificationRoute('/comunidades/abc/../def')).toBe(
      '/comunidades/def'
    );
  });

  it('rejeita destinos externos, protocol-relative e esquemas arbitrários', () => {
    expect(normalizeNotificationRoute('https://evil.example/phish')).toBeNull();
    expect(normalizeNotificationRoute('//evil.example/phish')).toBeNull();
    expect(normalizeNotificationRoute('javascript:alert(1)')).toBeNull();
  });

  it('rejeita barra invertida, controles, vazio e payload excessivo', () => {
    expect(normalizeNotificationRoute('/\\evil.example/phish')).toBeNull();
    expect(normalizeNotificationRoute('/chat\n/abc')).toBeNull();
    expect(normalizeNotificationRoute('   ')).toBeNull();
    expect(normalizeNotificationRoute(`/${'a'.repeat(2048)}`)).toBeNull();
  });
});

describe('resolveNotificationRoute', () => {
  it('corrige rota legada de mensagem de Sala somente com contexto canônico de Sala', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        roomId: 'room-123',
        route: '/messages/room-123/message-456?origem=notification#message',
      })
    ).toBe('/chat/rooms');
  });

  it('preserva a rota canônica atual de Salas', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        roomId: 'room-123',
        route: '/chat/rooms',
      })
    ).toBe('/chat/rooms');
  });

  it('preserva convite de Sala mesmo contendo roomId', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        roomId: 'room-123',
        route: '/chat/room-invites',
      })
    ).toBe('/chat/room-invites');
  });

  it('preserva chat direto sem roomId', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        route: '/chat?userId=user-456',
      })
    ).toBe('/chat?userId=user-456');
  });

  it('não converte /messages arbitrário sem contexto de Sala', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        route: '/messages/qualquer-coisa',
      })
    ).toBe('/messages/qualquer-coisa');

    expect(
      resolveNotificationRoute({
        type: 'system',
        roomId: 'room-123',
        route: '/messages/qualquer-coisa',
      })
    ).toBe('/messages/qualquer-coisa');
  });

  it('mantém a rejeição de rota externa mesmo com contexto de Sala', () => {
    expect(
      resolveNotificationRoute({
        type: 'chat',
        roomId: 'room-123',
        route: 'https://evil.example/phish',
      })
    ).toBeNull();
  });
});
