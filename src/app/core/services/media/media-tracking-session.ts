import type { User } from 'firebase/auth';
import { EMPTY, Observable, catchError, defer, filter, takeUntil, throwError } from 'rxjs';
import type { AuthSessionService } from '../autentication/auth/auth-session.service';

type TrackingAuth = Pick<AuthSessionService,
  'uid$' | 'currentAuthUser' | 'terminationVersionSnapshot' | 'isTerminatingSnapshot'>;

/** Session fence for telemetry, not an authorization or a permit cache. */
export class MediaTrackingSession {
  private constructor(
    private readonly auth: TrackingAuth,
    readonly user: User,
    private readonly version: number
  ) {}

  static capture(auth: TrackingAuth): MediaTrackingSession | null {
    const user = auth.currentAuthUser;
    return user?.uid && !auth.isTerminatingSnapshot
      ? new MediaTrackingSession(auth, user, auth.terminationVersionSnapshot)
      : null;
  }

  matches(other: MediaTrackingSession | null): boolean {
    return !!other && other.user === this.user && other.version === this.version;
  }

  isCurrent(): boolean {
    return this.auth.currentAuthUser === this.user &&
      this.auth.terminationVersionSnapshot === this.version &&
      !this.auth.isTerminatingSnapshot;
  }

  guard$<T>(work: () => Observable<T>): Observable<T> {
    return defer(() => {
      if (!this.isCurrent()) return EMPTY;
      return defer(work).pipe(
        takeUntil(this.auth.uid$.pipe(filter(uid => uid !== this.user.uid || !this.isCurrent()))),
        filter(() => this.isCurrent()),
        catchError(error => this.isCurrent() ? throwError(() => error) : EMPTY)
      );
    });
  }
}
