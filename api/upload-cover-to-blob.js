// api/upload-cover-to-blob.js
import { put } from '@vercel/blob';

const ALLOWED_HOSTS = /(^|\.)(tiktokv|tiktokcdn|byteoversea|ibytedtos|muscdn|tos-)\.com$/i;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { coverImg, date, likes, userId, sourceLink } = req.body || {};
    if (!coverImg) {
      return res.status(400).json({ success: false, error: 'coverImg required' });
    }

    let parsed;
    try { parsed = new URL(coverImg); } catch {
      return res.status(400).json({ success: false, error: 'invalid coverImg URL' });
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return res.status(400).json({ success: false, error: 'only http(s) URLs' });
    }
    if (!ALLOWED_HOSTS.test(parsed.hostname)) {
      return res.status(400).json({ success: false, error: `host not allowed: ${parsed.hostname}` });
    }

    // ── THIS IS THE MISSING "body" ───────────────────────────
    // Fetch the image bytes from the TikTok CDN.
    const upstream = await fetch(coverImg, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      redirect: 'follow',
    });

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

    const body = upstream.body;   // ← web ReadableStream, fed straight to put()
    // ─────────────────────────────────────────────────────────

    const dateStr = sanitizeDate(date) || Date.now().toString();
    const ext = pickExt(coverImg, contentType);
    const pathname = `cover_${dateStr}.${ext}`;

    const blob = await put(pathname, body, {
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
      pathname: blob.pathname,   // 'cover_2024-01-15T10_30_00Z.jpg'
      url: blob.url,             // public URL
      contentType,
      size: blob.size ?? null,
    });
  } catch (err) {
    console.error('upload-cover-to-blob error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Upload failed' });
  }
}
