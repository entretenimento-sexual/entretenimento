/** Cloud Storage adapter for the create-only, generation-pinned copy policy. */
import { storage } from '../../firebaseApp';
import type {
  GcsObjectSnapshot,
  ImmutableInputCopyCommand,
  ImmutableInputStoragePort,
  ImmutableInputJob,
  ImmutableTranscoderInput,
} from './video-immutable-input.policy';
import { prepareImmutableTranscoderInputWithPort } from './video-immutable-input.policy';

const bucket = () => storage.bucket();

function normalizeMetadata(value: {
  generation?: string | number;
  size?: string | number;
  crc32c?: string;
  contentType?: string;
  metadata?: { [key: string]: string | boolean | number | null };
}): GcsObjectSnapshot {
  return {
    generation: String(value.generation ?? ''),
    size: String(value.size ?? ''),
    crc32c: String(value.crc32c ?? ''),
    contentType: String(value.contentType ?? '').toLowerCase(),
    metadata: Object.fromEntries(Object.entries(value.metadata ?? {})
      .map(([key, item]) => [key, String(item ?? '')])),
  };
}

function is404(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error &&
    Number(error.code) === 404;
}

export function cloudStorageImmutableInputPort(): ImmutableInputStoragePort {
  return {
    async readPinnedSource(path: string, generation: string) {
      try {
        const [metadata] = await bucket().file(path, { generation }).getMetadata();
        return normalizeMetadata(metadata);
      } catch (error) {
        if (is404(error)) return null;
        throw error;
      }
    },
    async readDestination(path: string) {
      try {
        const [metadata] = await bucket().file(path).getMetadata();
        return normalizeMetadata(metadata);
      } catch (error) {
        if (is404(error)) return null;
        throw error;
      }
    },
    async copyPinnedSource(command: ImmutableInputCopyCommand) {
      await bucket().file(command.sourcePath, {
        generation: command.sourceGeneration,
      }).copy(bucket().file(command.destinationPath), {
        // Zero means CREATE ONLY: never overwrite another attempt's copy.
        preconditionOpts: { ifGenerationMatch: command.ifDestinationGenerationMatch },
        cacheControl: 'private, no-store, max-age=0',
        contentType: command.contentType,
        metadata: { ...command.metadata },
      });
    },
  };
}

/** Prepared only; NOT wired to the provider POST until lifecycle/cleanup fences exist. */
export function prepareImmutableTranscoderInput(
  job: ImmutableInputJob
): Promise<ImmutableTranscoderInput> {
  return prepareImmutableTranscoderInputWithPort(job, cloudStorageImmutableInputPort());
}
