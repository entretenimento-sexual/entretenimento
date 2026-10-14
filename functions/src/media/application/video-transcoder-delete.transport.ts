import axios from 'axios';

/**
 * A DELETE 404 means the *identified* provider resource is already absent.
 * It is never proof that an ambiguous POST failed to create a resource.
 * Invalid IDs and every other HTTP/transport error fail closed.
 */
export async function deleteVideoTranscoderJobWithTransport(
  externalJobName: string,
  transport: (jobName: string) => Promise<unknown>
): Promise<void> {
  if (
    !/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/.test(
      externalJobName
    )
  ) {
    throw new Error('Identificador do job de transcodificação inválido.');
  }

  try {
    await transport(externalJobName);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return;
    throw error;
  }
}
