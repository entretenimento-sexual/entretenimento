import type { VideoProcessingJob } from './video-processing-job';

export interface CancellationCleanupError {
  code: string;
  message: string;
}

/**
 * Ports are deliberately injected. Production connects Firebase and the
 * Transcoder; tests use an isolated Firestore and a simulated provider.
 */
export interface VideoCancellationPorts {
  findProviderJob: (version: string) => Promise<{ name: string } | null>;
  bindProviderJob: (job: VideoProcessingJob, name: string) => Promise<boolean>;
  deleteProviderJob: (name: string) => Promise<void>;
  deleteOutputPrefix: (prefix: string) => Promise<void>;
  /** Rotation deletion must be generation-pinned and claim-fenced. */
  deleteRotationInput?: (job: VideoProcessingJob) => Promise<boolean>;
  /** Optional for injected legacy test ports; production always supplies it. */
  deleteImmutableInput?: (job: VideoProcessingJob) => Promise<boolean>;
  deleteCancelledJob: (job: VideoProcessingJob) => Promise<boolean>;
  recordFailure: (
    job: VideoProcessingJob,
    error: CancellationCleanupError,
    now: number
  ) => Promise<boolean>;
  normalizeError: (error: unknown) => CancellationCleanupError;
  now: () => number;
}

export type VideoCancellationResult =
  | { status: 'COMPLETED' | 'REPLACED' | 'UNCONFIRMED' }
  | { status: 'RETRY_SCHEDULED'; error: CancellationCleanupError };

/**
 * No external deletion or storage cleanup is allowed while provider
 * existence is ambiguous or while a newer Firestore claim has won.
 * A 404 is considered success only by the provider transport adapter.
 */
export async function executeVideoCancellation(
  job: VideoProcessingJob,
  ports: VideoCancellationPorts
): Promise<VideoCancellationResult> {
  if (job.state !== 'CANCEL_REQUESTED') {
    return { status: 'REPLACED' };
  }

  try {
    let externalJobName = job.externalJobName;

    if (!externalJobName && job.attempts > 0) {
      const recovered = await ports.findProviderJob(job.processingVersion);
      if (!recovered) {
        const recorded = await ports.recordFailure(job, {
          code: 'CANCELLATION_UNCONFIRMED',
          message: 'Job externo não confirmado; limpeza aguarda revisão.',
        }, ports.now());
        return { status: recorded ? 'UNCONFIRMED' : 'REPLACED' };
      }

      const bound = await ports.bindProviderJob(job, recovered.name);
      if (!bound) return { status: 'REPLACED' };
      externalJobName = recovered.name;
    }

    if (externalJobName) {
      await ports.deleteProviderJob(externalJobName);
    }

    await ports.deleteOutputPrefix(job.outputPrefix);
    if (ports.deleteRotationInput) {
      if (!await ports.deleteRotationInput(job)) return { status: 'REPLACED' };
    } else if ([90, 180, 270].includes(job.editRecipe?.rotationDegrees ?? 0)) {
      throw new Error('ROTATION_CLEANUP_PORT_UNAVAILABLE');
    }
    if (job.immutableInput != null) {
      if (!ports.deleteImmutableInput) {
        throw new Error('IMMUTABLE_CLEANUP_PORT_UNAVAILABLE');
      }
      if (!await ports.deleteImmutableInput(job)) {
        return { status: 'REPLACED' };
      }
    }
    const deleted = await ports.deleteCancelledJob(job);
    return { status: deleted ? 'COMPLETED' : 'REPLACED' };
  } catch (error) {
    const normalized = ports.normalizeError(error);
    const recorded = await ports.recordFailure(job, normalized, ports.now());
    return recorded
      ? { status: 'RETRY_SCHEDULED', error: normalized }
      : { status: 'REPLACED' };
  }
}
