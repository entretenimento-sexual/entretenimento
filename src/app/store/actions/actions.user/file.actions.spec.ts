// src/app/store/actions/actions.user/file.actions.spec.ts
import { uploadStart } from './file.actions';

describe('file actions serializability', () => {
  it('uploadStart deve transportar somente metadados seguros e serializáveis', () => {
    const action = uploadStart({
      uploadId: 'upload-1',
      kind: 'image',
      sizeBytes: 2048,
      mimeType: 'image/webp',
    });

    expect(action).toEqual({
      type: '[File] Upload Start',
      uploadId: 'upload-1',
      kind: 'image',
      sizeBytes: 2048,
      mimeType: 'image/webp',
    });
    expect('file' in action).toBe(false);
    expect('path' in action).toBe(false);
    expect('userId' in action).toBe(false);
    expect('fileName' in action).toBe(false);
    expect(JSON.parse(JSON.stringify(action))).toEqual(action);
  });
});
