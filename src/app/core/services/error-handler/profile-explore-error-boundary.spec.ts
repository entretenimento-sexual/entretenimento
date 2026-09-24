import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');
const SCOPES = [
  'explore',
  'dashboard/discovery',
  'user-profile',
  'layout/other-user-profile-view',
] as const;

const CANONICAL_REPORTERS = [
  'dashboard/discovery/application/discovery-public-profiles.facade.ts',
  'explore/components/feed-publication-composer/feed-publication-composer.component.ts',
  'explore/pages/social-explore-page/social-explore-page.component.ts',
  'explore/services/explore-personal-media.service.ts',
  'layout/other-user-profile-view/other-user-profile-view.component.ts',
  'media/shared/services/public-mixed-media-viewer-launcher.service.ts',
  'user-profile/user-photo-manager/user-photo-manager.component.ts',
  'user-profile/user-profile-edit/edit-preferences/edit-profile-preferences.component.ts',
  'user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.ts',
  'user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts',
  'user-profile/user-profile-view/user-profile-preferences/user-profile-preferences.component.ts',
  'user-profile/user-profile-view/user-profile-view.component.ts',
  'user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts',
] as const;

function productionTypeScriptFiles(relativeDirectory: string): string[] {
  const directory = resolve(APP_ROOT, relativeDirectory);
  const files: string[] = [];

  const visit = (absoluteDirectory: string): void => {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolutePath = resolve(absoluteDirectory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'visual-validation') continue;
        visit(absolutePath);
        continue;
      }

      if (
        entry.isFile()
        && entry.name.endsWith('.ts')
        && !entry.name.endsWith('.spec.ts')
      ) {
        files.push(absolutePath);
      }
    }
  };

  visit(directory);
  return files;
}

describe('Profile/Explore application error boundary', () => {
  it('proíbe bypass direto para GlobalErrorHandlerService nas superfícies auditadas', () => {
    const violations: string[] = [];

    for (const scope of SCOPES) {
      for (const absolutePath of productionTypeScriptFiles(scope)) {
        const source = readFileSync(absolutePath, 'utf8');

        if (
          source.includes(
            "from 'src/app/core/services/error-handler/global-error-handler.service'"
          )
          || source.includes(
            "from '@core/services/error-handler/global-error-handler.service'"
          )
          || source.includes(
            "from '../../core/services/error-handler/global-error-handler.service'"
          )
          || source.includes(
            "from '../../../core/services/error-handler/global-error-handler.service'"
          )
        ) {
          violations.push(absolutePath.replace(APP_ROOT, 'src/app'));
        }
      }
    }

    expect(
      violations,
      'Perfil/Explore devem reportar falhas técnicas via ApplicationErrorService'
    ).toEqual([]);
  });

  it('proíbe apresentação manual de erro nas superfícies auditadas', () => {
    const violations: string[] = [];

    for (const scope of SCOPES) {
      for (const absolutePath of productionTypeScriptFiles(scope)) {
        const source = readFileSync(absolutePath, 'utf8');

        if (/\.showError\s*\(/.test(source)) {
          violations.push(absolutePath.replace(APP_ROOT, 'src/app'));
        }
      }
    }

    expect(
      violations,
      'Perfil/Explore/Discovery devem apresentar erros via ApplicationErrorService; validações locais usam warning.'
    ).toEqual([]);
  });

  it('mantém ApplicationErrorService nos consumidores migrados', () => {
    for (const relativePath of CANONICAL_REPORTERS) {
      const source = readFileSync(resolve(APP_ROOT, relativePath), 'utf8');

      expect(
        source,
        `${relativePath} perdeu a fronteira canônica de erro`
      ).toContain('ApplicationErrorService');
    }
  });
});
