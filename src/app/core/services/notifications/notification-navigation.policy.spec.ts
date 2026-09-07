import { describe, expect, it } from 'vitest';

import { normalizeNotificationRoute } from './notification-navigation.policy';

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
