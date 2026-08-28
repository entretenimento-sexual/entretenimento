// src/app/preferences/models/swipe-edge.model.ts
// Evento relacional viewer -> target.
// Serve para Tinder-like, histórico e rotação.
export type SwipeAction =
  | 'like'
  | 'pass'
  | 'super_like'
  | 'maybe'
  | 'rewind';

export type SwipeSourceSurface =
  | 'discovery_list'
  | 'tinder_stack'
  | 'profile_view'
  | 'compatibility_panel';

export interface SwipeEdge {
  viewerUid: string;
  targetUid: string;

  action: SwipeAction;
  sourceSurface: SwipeSourceSurface;

  createdAt: number;
  updatedAt: number;

  compatibilityScoreAtAction: number | null;
}