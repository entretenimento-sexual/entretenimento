// src/app/core/services/error-handler/application-error-boundary.architecture.spec.ts
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');

const CANONICAL_COMPOSITION_OWNER =
  'core/services/error-handler/application-error.service.ts';

/**
 * Infraestrutura de bootstrap, não composição manual de tratamento:
 * AppModule registra o ErrorHandler global e o serviço de apresentação.
 */
const INFRASTRUCTURE_EXCEPTIONS = new Set<string>([
  'app.module.ts',
]);

/**
 * Baseline de migração gradual.
 *
 * Regra:
 * - nenhum arquivo novo pode entrar aqui;
 * - quando um arquivo for migrado, ele deve ser removido desta lista;
 * - o teste também falha se uma entrada ficar obsoleta, forçando o baseline a
 *   diminuir de forma explícita até chegar a zero;
 * - Comunidades ficam fora deste boundary por decisão arquitetural do projeto.
 */
const LEGACY_MANUAL_COMPOSITION_BASELINE = new Set<string>([
  'core/services/filtering/filters/region-filter.service.ts',
  'core/services/image-handling/photo-firestore.service.ts',
  'core/services/image-handling/photo-upload-flow.service.ts',
  'core/services/image-handling/storage.service.ts',
  'core/services/media/media-command.service.ts',
  'core/services/media/media-photo-comments.service.ts',
  'core/services/media/media-public-query.service.ts',
  'core/services/media/media-publication.service.ts',
  'core/services/media/media-reactions.service.ts',
  'core/services/media/media-video-comments.service.ts',
  'core/services/media/media-video-ratings.service.ts',
  'core/services/media/public-media-owner-page-query.service.ts',
  'core/services/media/public-photo-ranking-query.service.ts',
  'core/services/media/public-video-chat-share.service.ts',
  'core/services/media/public-video-ranking-query.service.ts',
  'core/services/media/public-video-share.service.ts',
  'core/services/media/video-library.service.ts',
  'core/services/preferences/user-preferences.service.ts',
  'core/services/user-profile/user-profile.service.ts',
  'core/services/user-profile/user-social-links.service.ts',
  'dashboard/online/online-users/online-users.component.ts',
  'explore/components/feed-publication-composer/feed-publication-composer.component.ts',
  'explore/pages/social-explore-page/social-explore-page.component.ts',
  'explore/services/explore-personal-media.service.ts',
  'layout/friend-management/friend-search/friend-search.component.ts',
  'layout/friend-management/friend-settings/friend-settings.component.ts',
  'layout/other-user-profile-view/other-user-profile-view.component.ts',
  'layout/perfis-proximos/perfis-proximos.component.ts',
  'media/photos/boosted-public-photos/boosted-public-photos.component.ts',
  'media/photos/latest-public-photos/latest-public-photos.component.ts',
  'media/photos/photo-upload/photo-upload.component.ts',
  'media/photos/profile-photos/profile-photos.component.ts',
  'media/photos/public-profile-photos/public-profile-photos.component.ts',
  'media/photos/top-public-photos/top-public-photos.component.ts',
  'media/shared/components/profile-media-showcase/profile-media-showcase.component.ts',
  'media/shared/services/public-mixed-media-viewer-launcher.service.ts',
  'media/videos/public-profile-videos/public-profile-videos.component.ts',
  'photo-editor/photo-editor/photo-editor.component.ts',
  'preferences/application/compatibility-preview.facade.ts',
  'preferences/application/discovery-settings.facade.ts',
  'preferences/application/match-profile.facade.ts',
  'register-module/finalizar-cadastro/finalizar-cadastro.component.ts',
  'register-module/terms-acceptance/terms-acceptance-page.component.ts',
  'register-module/welcome/welcome.component.ts',
  'shared/components-globais/modal-mensagem/modal-mensagem.component.ts',
  'shared/components-globais/upload-photo/upload-photo.component.ts',
  'store/effects/effects.location/nearby-profiles.effects.ts',
  'store/effects/effects.user/online-users-effect-feedback.service.ts',
  'user-profile/user-photo-manager/user-photo-manager.component.ts',
  'user-profile/user-profile-edit/edit-preferences/edit-profile-preferences.component.ts',
  'user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.ts',
  'user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts',
  'user-profile/user-profile-view/user-profile-view.component.ts',
  'user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts',
]);

const ERROR_NOTIFICATION_IMPORT =
  /import\s*\{[^}]*\bErrorNotificationService\b[^}]*\}\s*from\s*['"][^'"]*error-notification\.service['"]/m;

const GLOBAL_ERROR_HANDLER_IMPORT =
  /import\s*\{[^}]*\bGlobalErrorHandlerService\b[^}]*\}\s*from\s*['"][^'"]*global-error-handler\.service['"]/m;

function collectRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const absolutePath = resolve(directory, entry);
      const stats = statSync(absolutePath);

      if (stats.isDirectory()) {
        return collectRuntimeTypeScriptFiles(absolutePath);
      }

      if (
        !entry.endsWith('.ts')
        || entry.endsWith('.spec.ts')
        || entry.endsWith('.test.ts')
      ) {
        return [];
      }

      return [absolutePath];
    });
}

function normalizedRelativePath(absolutePath: string): string {
  return relative(APP_ROOT, absolutePath).replaceAll('\\', '/');
}

function isCommunityOwned(relativePath: string): boolean {
  return relativePath.toLowerCase().includes('community');
}

function findManualCompositions(): string[] {
  return collectRuntimeTypeScriptFiles(APP_ROOT)
    .map((absolutePath) => ({
      absolutePath,
      relativePath: normalizedRelativePath(absolutePath),
    }))
    .filter(({ relativePath }) => (
      relativePath !== CANONICAL_COMPOSITION_OWNER
      && !INFRASTRUCTURE_EXCEPTIONS.has(relativePath)
      && !isCommunityOwned(relativePath)
    ))
    .filter(({ absolutePath }) => {
      const source = readFileSync(absolutePath, 'utf8');

      return ERROR_NOTIFICATION_IMPORT.test(source)
        && GLOBAL_ERROR_HANDLER_IMPORT.test(source);
    })
    .map(({ relativePath }) => relativePath)
    .sort();
}

describe('Application error ownership boundary', () => {
  it('não permite crescimento da composição manual fora de Comunidades', () => {
    const actual = new Set(findManualCompositions());

    const unexpected = [...actual]
      .filter((path) => !LEGACY_MANUAL_COMPOSITION_BASELINE.has(path))
      .sort();

    expect(
      unexpected,
      [
        'Nova composição manual detectada fora de Comunidades.',
        'Use ApplicationErrorService ou uma camada canônica já proprietária do erro.',
      ].join(' ')
    ).toEqual([]);
  });

  it('obriga o baseline legado a diminuir quando um arquivo é migrado', () => {
    const actual = new Set(findManualCompositions());

    const staleBaseline = [...LEGACY_MANUAL_COMPOSITION_BASELINE]
      .filter((path) => !actual.has(path))
      .sort();

    expect(
      staleBaseline,
      [
        'Há entradas já resolvidas no baseline de erros.',
        'Remova-as para que a dívida arquitetural registrada só possa diminuir.',
      ].join(' ')
    ).toEqual([]);
  });

  it('mantém explícito o tamanho atual da dívida fora de Comunidades', () => {
    expect(LEGACY_MANUAL_COMPOSITION_BASELINE.size).toBe(54);
  });
});
