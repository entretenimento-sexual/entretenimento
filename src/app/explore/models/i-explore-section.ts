//src\app\explore\models\i-explore-section.ts
export type TExploreSectionId =
  | 'boosted'
  | 'mostViewed'
  | 'top'
  | 'latest'
  | 'profiles'
  | 'rooms'
  | 'places'
  | 'videos';

export type TExploreSectionKind =
  | 'photos'
  | 'profiles'
  | 'rooms'
  | 'places'
  | 'videos';

export interface IExploreSection<TItem = unknown> {
  readonly id: TExploreSectionId;
  readonly kind: TExploreSectionKind;
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
  readonly note?: string;
  readonly items: readonly TItem[];
  readonly routeCommands?: readonly unknown[];
}
