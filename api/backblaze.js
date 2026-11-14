// api/backblaze.js
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage'; // 1. Import Upload

const B2_ENDPOINT = process.env.B2_ENDPOINT;
const B2_REGION   = process.env.B2_REGION;
const B2_BUCKET   = process.env.B2_BUCKET;
const B2_KEY_ID   = process.env.B2_KEY_ID;
const B2_APP_KEY  = process.env.B2_APP_KEY;

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: {
    accessKeyId: B2_KEY_ID,
    secretAccessKey: B2_APP_KEY,
  },
});

const ALLOWED_HOSTS = /(^|\.)(tiktokv|tiktokcdn|byteoversea|ibytedtos|muscdn|tos-)\.com$/i;
const MAX_BYTES = 300 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 90_000;

export const config = { maxDuration: 60, memory: 1024 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid JSON body' });
  }

  const { url, date, likes } = body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required' });
  }

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'invalid url' }); }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return res.status(400).json({ error: 'only http(s) URLs' });
  }
  if (!ALLOWED_HOSTS.test(parsed.hostname)) {
    return res.status(400).json({ error: 'host not allowed', host: parsed.hostname });
  }

  let dateStr;
  if (date) {
    dateStr = String(date);
    const iso = dateStr.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (iso) dateStr = iso[1];
    dateStr = dateStr.replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40);
  } else {
    dateStr = Date.now().toString();
  }
  const filename = `jafernegery${dateStr}.mp4`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': '*/*',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'upstream timeout' : 'upstream fetch failed',
      detail: e.message,
    });
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    return res.status(502).json({
      error: `upstream HTTP ${upstream.status}`,
      upstreamStatus: upstream.status,
    });
  }

  const contentLength = Number(upstream.headers.get('content-length')) || 0;
  if (contentLength && contentLength > MAX_BYTES) {
    clearTimeout(timer);
    try { await upstream.body?.cancel(); } catch {}
    return res.status(413).json({ error: 'file too large', bytes: contentLength, max: MAX_BYTES });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType && !/^(video\/|application\/octet-stream|binary\/)/i.test(contentType)) {
    clearTimeout(timer);
    try { await upstream.body?.cancel(); } catch {}
    return res.status(415).json({ error: 'unexpected content-type', contentType });
  }

  try {
    // 2. Replace PutObjectCommand with the Upload helper
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: B2_BUCKET,
        Key: filename,
        Body: upstream.body,          // The flowing ReadableStream
        ContentType: 'video/mp4',
        ContentLength: contentLength || undefined,
      },
      // Optional: Configure part size for very large files
      // partSize: 10 * 1024 * 1024, 
      // queueSize: 4,
    });

    await upload.done(); // This handles the stream hashing and upload
    clearTimeout(timer);

    const publicUrl = `https://${B2_BUCKET}.s3.${B2_REGION}.backblazeb2.com/${encodeURIComponent(filename)}`;

    return res.status(200).json({
      ok: true,
      filename,
      url: publicUrl,
      bytes: contentLength || null,
      likes: likes ?? null,
      datePosted: date ?? null,
    });
  } catch (e) {
    clearTimeout(timer);
    return res.status(500).json({
      error: 'storage failed',
      detail: e.message,
      name: e.name,
    });
  }
}
