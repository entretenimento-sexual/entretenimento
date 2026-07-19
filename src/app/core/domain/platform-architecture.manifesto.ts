// src/app/core/domain/platform-architecture.manifesto.ts
// =============================================================================
// DIRETRIZES DE ARQUITETURA DE INTERFACE, SEGURANÇA E NEGÓCIO (MANIFESTO)
// =============================================================================
// O projeto adota uma abordagem estritamente Mobile-First, antecipando futuras
// compilações nativas em formato APK e estruturando um ecossistema visual capaz
// de se adaptar de smartphones a smart TVs, em retrato ou paisagem.
//
// A interface deve ser minimalista, limpa e sofisticada, sem textos redundantes
// ou elementos desnecessários, com navegação intuitiva, ícones globais, modos
// claro, escuro e alto contraste e agrupamento pai/filho por menus e submenus.
//
// Perfis de acesso variam conforme assinatura. Angular entrega o frontend
// reativo e Firebase concentra autoridade, sigilo, discrição e proteção contra
// exposição indevida de identidade ou dados nas interações.
//
// Antes de produção, as prioridades são Locais e Salas, fotos e vídeos como
// vitrine pessoal, geolocalização lógica e check-ins seguros, além de salas de
// conversa ou murais vinculados a Locais. A arquitetura permanece preparada para
// monetização, rotas Premium/VIP e gateways compatíveis com o mercado adulto.
// =============================================================================

export const PLATFORM_ARCHITECTURE_MANIFESTO = Object.freeze({
  interface: Object.freeze({
    mobileFirst: true,
    nativePackageTarget: 'apk',
    responsiveTargets: Object.freeze([
      'phone',
      'tablet',
      'desktop',
      'smart-tv',
    ] as const),
    orientations: Object.freeze(['portrait', 'landscape'] as const),
    themes: Object.freeze(['light', 'dark', 'high-contrast'] as const),
    navigation: 'parent-child-menus' as const,
    visualLanguage: 'minimal-clean-sophisticated' as const,
  }),
  security: Object.freeze({
    frontend: 'angular' as const,
    authority: 'firebase-backend' as const,
    privacyByDefault: true,
    identityExposure: 'minimum-necessary' as const,
    directStructuralWrites: false,
  }),
  access: Object.freeze({
    subscriptionAware: true,
    tiers: Object.freeze(['basic', 'premium', 'vip'] as const),
    restrictedRoutesSupported: true,
  }),
  priorities: Object.freeze([
    'venues',
    'rooms',
    'user-photo-video-showcase',
    'logical-geolocation',
    'safe-check-ins',
    'venue-linked-rooms-and-walls',
    'adult-market-monetization',
  ] as const),
});
