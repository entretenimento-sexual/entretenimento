import { describe, expect, it } from 'vitest';
import { resolveVideoProcessingFailureFeedback } from './video-processing-failure-feedback.policy';

describe('video-processing-failure-feedback.policy', () => {
  it('diferencia falha do arquivo, edição e serviço temporário', () => {
    expect(resolveVideoProcessingFailureFeedback('INVALID_PROCESSING_SOURCE').retryable).toBe(false);
    expect(resolveVideoProcessingFailureFeedback('INVALID_VIDEO_EDIT_RECIPE').title).toBe('Edição não aplicada');
    expect(resolveVideoProcessingFailureFeedback('VIDEO_PROBE_TIMEOUT').retryable).toBe(true);
  });

  it('trata troca da geração da origem como falha definitiva', () => {
    const feedback = resolveVideoProcessingFailureFeedback('VIDEO_PROBE_GENERATION_MISMATCH');
    expect(feedback.retryable).toBe(false);
    expect(feedback.title).toBe('Arquivo de origem alterado');
  });

  it('não trata ausência de áudio como erro', () => {
    expect(resolveVideoProcessingFailureFeedback('AUDIO_MISSING').title)
      .toBe('Preparação não concluída');
  });

  it('nunca incorpora o erro técnico ou dados do provedor ao feedback', () => {
    const malicious = 'Error: gs://private-bucket/secret.mp4';
    const feedback = resolveVideoProcessingFailureFeedback(malicious);
    expect(JSON.stringify(feedback)).not.toContain('private-bucket');
    expect(feedback).toEqual(resolveVideoProcessingFailureFeedback(null));
  });

  it('não inicia nova tentativa silenciosamente quando o serviço falha', () => {
    const feedback = resolveVideoProcessingFailureFeedback('MAX_ATTEMPTS_EXCEEDED');
    expect(feedback.retryable).toBe(true);
    expect(feedback.recovery).toContain('outra cópia');
  });
});

describe('video-processing: reconciliação', () => {
  it('não recomenda reenviar quando a submissão ao Transcoder é incerta', () => {
    const feedback = resolveVideoProcessingFailureFeedback(
      'TRANSCODER_SUBMISSION_UNCONFIRMED'
    );

    expect(feedback.title).toBe('Confirmação do processamento pendente');
    expect(feedback.retryable).toBe(false);
    expect(feedback.recovery).toContain('Não reenvie');
    expect(feedback.recovery).not.toContain('outra cópia');
  });
});