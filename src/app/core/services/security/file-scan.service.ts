//src\app\core\services\security\file-scan.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FileScanService {
  private virusTotalUrl = 'https://www.virustotal.com/vtapi/v2/file/scan';
  private apiKey = environment.virusTotalApiKey; 

  constructor(private http: HttpClient) { }

  scanFile(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('apikey', this.apiKey);

    return this.http.post(this.virusTotalUrl, formData).toPromise();
  }

  getScanReport(resource: string): Promise<any> {
    const reportUrl = 'https://www.virustotal.com/vtapi/v2/file/report';
    return this.http.get(`${reportUrl}?apikey=${this.apiKey}&resource=${resource}`).toPromise();
  }
}
