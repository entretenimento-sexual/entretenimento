export class MediaViewRecordingRegistry {
  private readonly pendingKeys = new Set<string>();
  private readonly recordedKeys = new Set<string>();

  tryStart(key: string): boolean {
    const safeKey = String(key ?? '').trim();

    if (
      !safeKey ||
      this.pendingKeys.has(safeKey) ||
      this.recordedKeys.has(safeKey)
    ) {
      return false;
    }

    this.pendingKeys.add(safeKey);
    return true;
  }

  confirm(key: string): void {
    const safeKey = String(key ?? '').trim();

    if (!safeKey) {
      return;
    }

    this.pendingKeys.delete(safeKey);
    this.recordedKeys.add(safeKey);
  }

  release(key: string): void {
    const safeKey = String(key ?? '').trim();

    if (!safeKey) {
      return;
    }

    this.pendingKeys.delete(safeKey);
  }

  isRecorded(key: string): boolean {
    return this.recordedKeys.has(String(key ?? '').trim());
  }

  isPending(key: string): boolean {
    return this.pendingKeys.has(String(key ?? '').trim());
  }
}
