import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { IProfileVideoStoredItem } from './profile-video-library.models';

export const ProfileVideoLibraryActions = createActionGroup({
  source: 'Profile Video Library',
  events: {
    'Watch Requested': props<{ ownerUid: string }>(),
    'Watch Stopped': emptyProps(),
    'Snapshot Received': props<{
      ownerUid: string;
      items: IProfileVideoStoredItem[];
    }>(),
    'Failed Uploads Detected': props<{
      ownerUid: string;
      videoIds: string[];
    }>(),
    'Legacy Pending Moderation Detected': props<{
      ownerUid: string;
      videoIds: string[];
    }>(),
    'Watch Failed': props<{
      ownerUid: string;
      message: string;
    }>(),
  },
});