import { onCall } from 'firebase-functions/v2/https';

import { PROTECTED_CALLABLE_OPTIONS } from '../../config/protected-callable-options';
import {
  recordPhotoViewCore,
  type RecordPhotoViewRequest,
} from './record-photo-view.handler';

export const recordPhotoView = onCall<RecordPhotoViewRequest>(
  PROTECTED_CALLABLE_OPTIONS,
  recordPhotoViewCore
);
