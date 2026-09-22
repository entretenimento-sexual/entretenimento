// src/app/core/domain/room-surface-boundary.architecture.spec.ts
import { describe, expect, it } from 'vitest';

import {
  CHAT_ROUTES,
} from '../../chat-module/chat-module-routing.module';
import { ChatRoomsComponent } from '../../chat-module/chat-rooms/chat-rooms.component';
import {
  DASHBOARD_ROUTES,
} from '../../dashboard/dashboard-routing.module';
import { ROOM_COMPATIBILITY_SURFACE } from './room-compatibility.policy';
import { SOCIAL_SPACE_DEFINITIONS } from './social-space.definition';

describe('Room compatibility surface boundary', () => {
  it('mantém /chat/rooms como única superfície compatível que monta Salas', () => {
    const canonicalRoute = CHAT_ROUTES.find((route) => route.path === 'rooms');
    const dashboardShell = DASHBOARD_ROUTES.find((route) => route.path === '');
    const dashboardRoomRoutes = (dashboardShell?.children ?? []).filter(
      (route) => route.path === 'chat-rooms'
    );

    expect(ROOM_COMPATIBILITY_SURFACE).toMatchObject({
      productState: 'deprecated_compatibility_only',
      canonicalRoute: '/chat/rooms',
      canonicalCollectiveDomain: 'community',
      newFeaturesAllowed: false,
    });
    expect(ROOM_COMPATIBILITY_SURFACE.temporaryAliases).toEqual([
      '/dashboard/chat-rooms',
    ]);

    expect(canonicalRoute?.component).toBe(ChatRoomsComponent);

    expect(dashboardRoomRoutes).toHaveLength(1);
    expect(dashboardRoomRoutes[0]).toMatchObject({
      redirectTo: ROOM_COMPATIBILITY_SURFACE.canonicalRoute,
      pathMatch: 'full',
    });
    expect(dashboardRoomRoutes[0]?.component).toBeUndefined();
    expect(dashboardRoomRoutes[0]?.loadComponent).toBeUndefined();

    const dashboardMountedRoomComponents = (dashboardShell?.children ?? [])
      .filter((route) => route.component === ChatRoomsComponent);

    expect(dashboardMountedRoomComponents).toEqual([]);
    expect(SOCIAL_SPACE_DEFINITIONS.room.navigationRoute).toBe(
      ROOM_COMPATIBILITY_SURFACE.canonicalRoute
    );
  });
});
