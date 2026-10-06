import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('legacy file upload slice removal', () => {
  it('não registra slice global de upload no AppState nem root reducer', () => {
    const appState = source('src/app/store/states/app.state.ts');
    const reducers = source('src/app/store/reducers/index.ts');
    const features = source('src/app/store/reducers/feature-keys.ts');

    expect(appState).not.toContain('fileReducer');
    expect(appState).not.toMatch(/\bfile:\s*ReturnType/);
    expect(reducers).not.toContain('STORE_FEATURE.file');
    expect(features).not.toMatch(/\bfile:\s*['"]file['"]/);
  });

  it('documenta que o estado runtime de upload fica fora do Store global', () => {
    const storeModule = source('src/app/store/store.module.ts');

    expect(storeModule).toContain(
      'o antigo slice/effect global de upload foi removido'
    );
  });
});
