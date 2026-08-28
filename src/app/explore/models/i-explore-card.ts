//src\app\explore\models\i-explore-card.ts
export type TExploreCardKind =
  | 'photo'
  | 'profile'
  | 'room'
  | 'place'
  | 'video';

export interface IExploreCard<TPayload = unknown> {
  readonly id: string;
  readonly kind: TExploreCardKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly imageUrl?: string;
  readonly badge?: string;
  readonly score?: number;
  readonly routeCommands?: readonly unknown[];
  readonly payload?: TPayload;
}
