// src/app/core/services/security/file-scan.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

type VTConfig = NonNullable<(typeof environment)['integrations']>['virusTotal'];

@Injectable({ providedIn: 'root' })
export class FileScanService {
  private readonly vt = environment.integrations?.virusTotal;
  private vtCfg: VTConfig = environment.integrations?.virusTotal as VTConfig;

  constructor(private http: HttpClient) { }

  private getFunctionsBaseUrl(): string {

    const region = this.vtCfg?.region || 'us-central1';
    const projectId = environment.firebase.projectId as string;

    // Emulador de Functions
    if ((environment as any).useEmulators && (environment as any).emulators?.functions) {
      const { host, port } = (environment as any).emulators.functions;
      // Padrão do emulator: http://localhost:5001/{projectId}/{region}/fnName
      return `http://${host}:${port}/${projectId}/${region}`;
    }
    // Produção/real: https://{region}-{projectId}.cloudfunctions.net/fnName
    return `https://${region}-${projectId}.cloudfunctions.net`;
  }

  async scanFile(_file: File): Promise<any> {
    // VT desligado => ignora
    if (!this.vt?.enabled) return { status: 'skipped' as const };
    // (quando habilitar futuramente: chame seu proxy/function aqui)
    return { status: 'skipped' as const };
  }

  async getScanReport(_resource: string): Promise<any> {
    if (!this.vt?.enabled) return { status: 'skipped' as const };
    return { status: 'skipped' as const };
  }
}
