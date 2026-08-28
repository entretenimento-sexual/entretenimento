// functions/src/virustotal/proxy.ts
import { onRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import axios from 'axios';

// CommonJS-style imports evitam esModuleInterop
import Busboy = require('busboy');
import FormData = require('form-data');

// Tipos do busboy (vem de @types/busboy)
import type { FileInfo } from 'busboy';

const VT_API_KEY = process.env.VT_API_KEY;

export const virusTotalScan = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }
      if (!VT_API_KEY) { res.status(500).send('VT_API_KEY missing'); return; }

      const bb = Busboy({ headers: req.headers });
      let filename = 'file.bin';
      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        bb.on('file', (_name: string, file: NodeJS.ReadableStream, info: FileInfo) => {
          if (info?.filename) filename = info.filename;
          file.on('data', (d: Buffer) => chunks.push(d));
          file.on('end', () => { });
        });
        bb.on('finish', resolve);
        bb.on('error', reject);
        req.pipe(bb);
      });

      const fileBuffer = Buffer.concat(chunks);
      const form = new FormData();
      form.append('file', fileBuffer, filename);
      form.append('apikey', VT_API_KEY);

      const vtResp = await axios.post(
        'https://www.virustotal.com/vtapi/v2/file/scan',
        form,
        { headers: form.getHeaders() }
      );

      res.status(200).json(vtResp.data);
    } catch (e: any) {
      logger.error(e);
      res.status(500).send(e?.message ?? 'Internal error');
    }
  }
);

export const virusTotalReport = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    try {
      if (req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }
      if (!VT_API_KEY) { res.status(500).send('VT_API_KEY missing'); return; }

      const resource = String(req.query['resource'] ?? '');
      if (!resource) { res.status(400).send('Missing resource'); return; }

      const vtResp = await axios.get(
        'https://www.virustotal.com/vtapi/v2/file/report',
        { params: { apikey: VT_API_KEY, resource } }
      );

      res.status(200).json(vtResp.data);
    } catch (e: any) {
      logger.error(e);
      res.status(500).send(e?.message ?? 'Internal error');
    }
  }
);
