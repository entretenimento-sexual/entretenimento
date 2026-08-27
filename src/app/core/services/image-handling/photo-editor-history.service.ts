import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

export const PHOTO_EDITOR_HISTORY_LIMIT = 50;
const CONTINUOUS_CHANGE_WINDOW_MS = 350;

type PhotoEditorContinuousMutation = 'zoom' | 'pan';

export interface PhotoEditorHistorySnapshot {
  readonly state: string;
  readonly selectedOverlayId: string | null;
}

export interface PhotoEditorHistoryStatus {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly size: number;
  readonly index: number;
}

const EMPTY_STATUS: PhotoEditorHistoryStatus = {
  canUndo: false,
  canRedo: false,
  size: 0,
  index: -1,
};

@Injectable()
export class PhotoEditorHistoryService {
  private entries: PhotoEditorHistorySnapshot[] = [];
  private index = -1;
  private lastContinuousMutation: PhotoEditorContinuousMutation | null = null;
  private lastContinuousMutationAt = 0;

  private readonly currentSubject =
    new BehaviorSubject<PhotoEditorHistorySnapshot | null>(null);
  private readonly statusSubject =
    new BehaviorSubject<PhotoEditorHistoryStatus>(EMPTY_STATUS);

  readonly current$: Observable<PhotoEditorHistorySnapshot | null> =
    this.currentSubject.asObservable();
  readonly status$: Observable<PhotoEditorHistoryStatus> =
    this.statusSubject.asObservable();
  readonly canUndo$: Observable<boolean> = this.status$.pipe(
    map((status) => status.canUndo),
    distinctUntilChanged()
  );
  readonly canRedo$: Observable<boolean> = this.status$.pipe(
    map((status) => status.canRedo),
    distinctUntilChanged()
  );

  get current(): PhotoEditorHistorySnapshot | null {
    return this.cloneSnapshot(this.entries[this.index] ?? null);
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  get size(): number {
    return this.entries.length;
  }

  reset(initialSnapshot: PhotoEditorHistorySnapshot): void {
    const normalized = this.normalizeSnapshot(initialSnapshot);
    this.entries = [normalized];
    this.index = 0;
    this.resetContinuousMutation();
    this.publish();
  }

  commit(nextSnapshot: PhotoEditorHistorySnapshot): boolean {
    const normalized = this.normalizeSnapshot(nextSnapshot);
    const current = this.entries[this.index] ?? null;

    if (current?.state === normalized.state) {
      if (current.selectedOverlayId !== normalized.selectedOverlayId) {
        this.entries[this.index] = normalized;
        this.publish();
      }
      return false;
    }

    const now = Date.now();
    const continuousMutation = current
      ? this.inferContinuousMutation(current.state, normalized.state)
      : null;
    const canCoalesce =
      continuousMutation !== null &&
      continuousMutation === this.lastContinuousMutation &&
      now - this.lastContinuousMutationAt <= CONTINUOUS_CHANGE_WINDOW_MS &&
      this.index > 0 &&
      this.index === this.entries.length - 1;

    if (canCoalesce) {
      this.entries[this.index] = normalized;
      this.lastContinuousMutationAt = now;
      this.publish();
      return false;
    }

    const nextEntries = this.entries.slice(0, this.index + 1);
    nextEntries.push(normalized);

    if (nextEntries.length > PHOTO_EDITOR_HISTORY_LIMIT) {
      nextEntries.splice(0, nextEntries.length - PHOTO_EDITOR_HISTORY_LIMIT);
    }

    this.entries = nextEntries;
    this.index = this.entries.length - 1;
    this.lastContinuousMutation = continuousMutation;
    this.lastContinuousMutationAt = continuousMutation ? now : 0;
    this.publish();
    return true;
  }

  undo(): PhotoEditorHistorySnapshot | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    this.resetContinuousMutation();
    this.publish();
    return this.current;
  }

  redo(): PhotoEditorHistorySnapshot | null {
    if (!this.canRedo) return null;
    this.index += 1;
    this.resetContinuousMutation();
    this.publish();
    return this.current;
  }

  clear(): void {
    this.entries = [];
    this.index = -1;
    this.resetContinuousMutation();
    this.currentSubject.next(null);
    this.statusSubject.next(EMPTY_STATUS);
  }

  private publish(): void {
    this.currentSubject.next(this.current);
    this.statusSubject.next({
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      size: this.entries.length,
      index: this.index,
    });
  }

  private inferContinuousMutation(
    currentState: string,
    nextState: string
  ): PhotoEditorContinuousMutation | null {
    try {
      const current = JSON.parse(currentState) as Record<string, unknown>;
      const next = JSON.parse(nextState) as Record<string, unknown>;
      if (!current || !next || typeof current !== 'object' || typeof next !== 'object') {
        return null;
      }

      const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
      const changedKeys = [...keys].filter(
        (key) => JSON.stringify(current[key]) !== JSON.stringify(next[key])
      );

      if (changedKeys.length === 1 && changedKeys[0] === 'zoom') {
        return 'zoom';
      }
      if (
        changedKeys.length > 0 &&
        changedKeys.every((key) => key === 'panX' || key === 'panY')
      ) {
        return 'pan';
      }
    } catch {
      // Estados serializados opacos continuam válidos; apenas não são agrupados.
    }

    return null;
  }

  private resetContinuousMutation(): void {
    this.lastContinuousMutation = null;
    this.lastContinuousMutationAt = 0;
  }

  private normalizeSnapshot(
    snapshot: PhotoEditorHistorySnapshot
  ): PhotoEditorHistorySnapshot {
    const state = String(snapshot?.state ?? '').trim();
    if (!state) {
      throw new Error('O histórico do editor requer um estado serializado válido.');
    }

    return {
      state,
      selectedOverlayId: snapshot.selectedOverlayId
        ? String(snapshot.selectedOverlayId)
        : null,
    };
  }

  private cloneSnapshot(
    snapshot: PhotoEditorHistorySnapshot | null
  ): PhotoEditorHistorySnapshot | null {
    return snapshot ? { ...snapshot } : null;
  }
}
