//src\app\store\states\file.state.ts
export interface FileState {
  uploading: boolean;
  progress: number;
  error: string | null;
  success: boolean;        // Nova propriedade para sucesso
  downloadUrl: string | null; // Nova propriedade para a URL de download
}

export const initialFileState: FileState = {
  uploading: false,
  progress: 0,
  error: null,
  success: false,           // Inicializado como falso
  downloadUrl: null         // Inicializado como nulo
};
