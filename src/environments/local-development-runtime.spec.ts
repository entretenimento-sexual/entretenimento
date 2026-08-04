import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { environment as emulatorEnvironment } from './environment.dev-emu';

interface AngularWorkspaceContract {
  projects?: {
    entretenimento?: {
      architect?: {
        build?: {
          configurations?: {
            development?: {
              fileReplacements?: ReadonlyArray<{
                replace?: string;
                with?: string;
              }>;
            };
          };
        };
        serve?: {
          defaultConfiguration?: string;
          configurations?: {
            development?: {
              buildTarget?: string;
            };
          };
        };
      };
    };
  };
}

describe('contrato do runtime local', () => {
  it('serve development com o environment emulado', () => {
    const workspace = JSON.parse(
      readFileSync(resolve(process.cwd(), 'angular.json'), 'utf8')
    ) as AngularWorkspaceContract;
    const architect = workspace.projects?.entretenimento?.architect;
    const developmentBuild = architect?.build?.configurations?.development;
    const replacements = developmentBuild?.fileReplacements ?? [];

    expect(architect?.serve?.defaultConfiguration).toBe('development');
    expect(
      architect?.serve?.configurations?.development?.buildTarget
    ).toBe('entretenimento:build:development');
    expect(replacements).toContainEqual({
      replace: 'src/environments/environment.ts',
      with: 'src/environments/environment.dev-emu.ts',
    });
  });

  it('mantém todos os serviços Firebase locais conectados aos emuladores', () => {
    expect(emulatorEnvironment.useEmulators).toBe(true);
    expect(emulatorEnvironment.emulators?.auth).toEqual({
      host: '127.0.0.1',
      port: 9099,
    });
    expect(emulatorEnvironment.emulators?.firestore).toEqual({
      host: '127.0.0.1',
      port: 8080,
    });
    expect(emulatorEnvironment.emulators?.storage).toEqual({
      host: '127.0.0.1',
      port: 9199,
    });
    expect(emulatorEnvironment.emulators?.functions).toEqual({
      host: '127.0.0.1',
      port: 5001,
    });
    expect(emulatorEnvironment.emulators?.database).toEqual({
      host: '127.0.0.1',
      port: 9000,
    });
  });
});
