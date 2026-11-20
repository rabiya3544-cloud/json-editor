// api/upload-cover-to-blob.js
// Upload ONLY CoverImage to Vercel Blob.
// Supports two modes:
//   A) application/json       -> { coverImg, date, likes, userId, sourceLink }
//      (server fetches the image from TikTok CDN — may hit timeouts/IP blocks)
//   B) multipart/form-data    -> file=<binary>, date, likes, userId, sourceLink
//      (browser already downloaded the bytes — preferred, avoids CDN blocks)
import { put } from '@vercel/blob';
import formidable from 'formidable';

const ALLOWED_HOSTS =
  /(^|\.)(tiktokv|tiktokcdn|byteoversea|ibytedtos|muscdn|tos-)\.com$/i;

export const config = {
  api: {
    bodyParser: false,          // we parse multipart ourselves
    sizeLimit: '10mb',
  },
};

// ---------- helpers ----------
function sanitizeDate(date) {
  if (!date) return null;
  return String(date).replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40);
}

function pickExt(url, contentType) {
  const m = String(url || '').match(/\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  if (contentType) {
    if (contentType.includes('png'))  return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif'))  return 'gif';
    if (contentType.includes('avif')) return 'avif';
    if (contentType.includes('jpeg')) return 'jpg';
  }
  return 'jpg';
}

function readJsonBody(req) {
  // bodyParser is off, so read the raw stream ourselves
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024, multiples: false });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      // formidable v3 returns arrays; normalize
      const flatFields = {};
      for (const [k, v] of Object.entries(fields || {})) {
        flatFields[k] = Array.isArray(v) ? v[0] : v;
      }
      const f = files && files.file
        ? (Array.isArray(files.file) ? files.file[0] : files.file)
        : null;
      resolve({ fields: flatFields, file: f });
    });
  });
}

async function uploadFromBuffer({ buffer, contentType, filename, date, likes, userId, sourceLink }) {
  const dateStr = sanitizeDate(date) || Date.now().toString();
  const ext = pickExt(filename, contentType);
  const pathname = `cover_${dateStr}.${ext}`;

  const blob = await put(pathname, buffer, {
    access: 'public',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    contentType,
    customMetadata: {
      date: String(date || ''),
      likes: String(likes ?? 0),
      sourceLink: String(sourceLink || ''),
      userId: String(userId || ''),
    },
  });

  return {
    success: true,
    pathname: blob.pathname,
    url: blob.url,
    contentType,
    size: blob.size ?? buffer.length,
  };
}

// ---------- handler ----------
export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ct = String(req.headers['content-type'] || '');

  try {
    // =========================================================
    // MODE B — multipart/form-data (browser-supplied bytes)
    // =========================================================
    if (ct.startsWith('multipart/form-data')) {
      const { fields, file } = await readMultipart(req);
      if (!file || !file.filepath) {
        return res.status(400).json({ success: false, error: 'file field required' });
      }

      // file.mimetype is set by formidable from the part's Content-Type
      let contentType = file.mimetype || 'image/jpeg';
      if (!/^image\//i.test(contentType)) {
        return res.status(415).json({ success: false, error: `not an image: ${contentType}` });
      }

      // Read the temp file into a buffer
      const fs = await import('node:fs/promises');
      const buffer = await fs.readFile(file.filepath);

      const out = await uploadFromBuffer({
        buffer,
        contentType,
        filename: file.originalFilename || '',
        date: fields.date,
        likes: fields.likes,
        userId: fields.userId,
        sourceLink: fields.sourceLink,
      });

      // best-effort cleanup of formidable temp file
      fs.unlink(file.filepath).catch(() => {});
      return res.status(200).json(out);
    }

    // =========================================================
    // MODE A — application/json (server fetches from TikTok CDN)
    // =========================================================
    if (ct.startsWith('application/json')) {
      const { coverImg, date, likes, userId, sourceLink } = await readJsonBody(req);

      if (!coverImg) {
        return res.status(400).json({ success: false, error: 'coverImg required' });
      }

      let parsed;
      try { parsed = new URL(coverImg); }
      catch { return res.status(400).json({ success: false, error: 'invalid coverImg URL' }); }

      if (!/^https?:$/.test(parsed.protocol)) {
        return res.status(400).json({ success: false, error: 'only http(s) URLs' });
      }
      if (!ALLOWED_HOSTS.test(parsed.hostname)) {
        return res.status(400).json({ success: false, error: `host not allowed: ${parsed.hostname}` });
      }

      // 8s timeout so we return a readable error instead of a silent 504
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      let upstream;
      try {
        upstream = await fetch(coverImg, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124 Safari/537.36',
            'Referer': 'https://www.tiktok.com/',
            'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const msg = e.name === 'AbortError' ? 'upstream timeout (8s)' : `upstream fetch: ${e.message}`;
        return res.status(504).json({ success: false, error: msg });
      }
      clearTimeout(timer);

      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({
          success: false,
          error: `upstream fetch failed: HTTP ${upstream.status}`,
        });
      }

      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!/^image\//i.test(contentType)) {
        return res.status(415).json({ success: false, error: `not an image: ${contentType}` });
      }

      // Stream directly into put() — no full buffering needed
      const dateStr = sanitizeDate(date) || Date.now().toString();
      const ext = pickExt(coverImg, contentType);
      const pathname = `cover_${dateStr}.${ext}`;

      const blob = await put(pathname, upstream.body, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        contentType,
        customMetadata: {
          date: String(date || ''),
          likes: String(likes ?? 0),
          sourceLink: String(sourceLink || ''),
          userId: String(userId || ''),
        },
      });

      return res.status(200).json({
        success: true,
        pathname: blob.pathname,
        url: blob.url,
        contentType,
        size: blob.size ?? null,
      });
    }

    return res.status(415).json({
      success: false,
      error: `unsupported content-type: ${ct}`,
    });
  } catch (err) {
    console.error('upload-cover-to-blob error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Upload failed' });
  }
}
