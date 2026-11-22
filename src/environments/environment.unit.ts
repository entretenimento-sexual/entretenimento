import type { AppEnvironment } from './environment.model';
import { environment as emulatorEnvironment } from './environment.dev-emu';

export const environment: AppEnvironment = {
  ...emulatorEnvironment,
  env: 'test',
  useEmulators: false,
  emulators: undefined,
  authActionHandlerBaseUrl: undefined,
  firebase: {
    ...emulatorEnvironment.firebase,
    projectId: 'demo-entretenimento-unit-tests',
    storageBucket: 'demo-entretenimento-unit-tests.invalid',
  },
  features: {
    ...emulatorEnvironment.features,
    emailFirstSignupPreview: false,
    subscriberExperiencesPreview: false,
    communityPreview: false,
  },
};
