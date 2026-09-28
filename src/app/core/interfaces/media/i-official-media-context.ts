export interface IOfficialMediaContextProjection {
  readonly identity: {
    readonly verified: true;
    readonly type: 'profile';
  };
  readonly association: {
    readonly verified: true;
  };
  readonly target: {
    readonly type: 'profile';
    readonly id: string;
  };
}
