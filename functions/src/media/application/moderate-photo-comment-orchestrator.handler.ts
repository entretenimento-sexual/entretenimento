import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  moderatePhotoComment as moderatePhotoCommentCore,
} from './manage-photo-comment.handler';
import {
  REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  assertPublicMediaCallableAppCheck,
} from './public-media-callable-security';

export const moderatePhotoComment = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_PUBLIC_MEDIA_APP_CHECK,
  },
  async (request) => {
    assertPublicMediaCallableAppCheck(request.app);
    return moderatePhotoCommentCore.run(request as any);
  }
);
