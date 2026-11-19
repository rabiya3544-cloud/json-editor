import { createClient } from "@tursodatabase/serverless/compat";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export { client };

function rowsToObjects(result) {
  const cols = result.columns || [];
  return (result.rows || []).map(row => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
}

/* ------------------------------------------------------------------ */
/*  WRITE                                                              */
/* ------------------------------------------------------------------ */

export async function insertPosts(post) {
  const sql = `
    INSERT INTO tiktok_posts (
      "Date", "Link", "Likes", "WhoCanView",
      "AllowComments", "AllowStitches", "AllowDuets", "AllowStickers", "AllowSharingToStory",
      "ContentDisclosure", "AIGeneratedContent", "Sound", "Location",
      "Title", "AddYoursText", "AlternateText", "CoverImage", "NumberOfCollections"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const args = [
    post.Date,
    post.Link,
    post.Likes != null ? Number(String(post.Likes).replace(/,/g, '')) : 0,
    post.WhoCanView,
    post.AllowComments ? 1 : 0,
    post.AllowStitches ? 1 : 0,
    post.AllowDuets ? 1 : 0,
    post.AllowStickers ? 1 : 0,
    post.AllowSharingToStory ? 1 : 0,
    post.ContentDisclosure,
    post.AIGeneratedContent,
    post.Sound,
    post.Location,
    post.Title,
    post.AddYoursText,
    post.AlternateText,
    post.CoverImage,
    post.NumberOfCollections,
  ];

  return await client.execute(sql, args);
}

export async function insertBulkPosts(posts) {
  const sql = `
    INSERT INTO tiktok_posts (
      "Date", "Link", "Likes", "WhoCanView",
      "AllowComments", "AllowStitches", "AllowDuets", "AllowStickers", "AllowSharingToStory",
      "ContentDisclosure", "AIGeneratedContent", "Sound", "Location",
      "Title", "AddYoursText", "AlternateText", "CoverImage", "NumberOfCollections"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const statements = posts.map((post) => ({
    sql,
    args: [
      post.Date,
      post.Link,
      post.Likes != null ? Number(String(post.Likes).replace(/,/g, '')) : 0,
      post.WhoCanView,
      post.AllowComments ? 1 : 0,
      post.AllowStitches ? 1 : 0,
      post.AllowDuets ? 1 : 0,
      post.AllowStickers ? 1 : 0,
      post.AllowSharingToStory ? 1 : 0,
      post.ContentDisclosure,
      post.AIGeneratedContent,
      post.Sound,
      post.Location,
      post.Title,
      post.AddYoursText,
      post.AlternateText,
      post.CoverImage,
      post.NumberOfCollections,
    ],
  }));

  return await client.batch(statements, "write");
}

/* ------------------------------------------------------------------ */
/*  WRITE — update Status for posts (by Date)                          */
/* ------------------------------------------------------------------ */

export async function updatePostsStatusByDates(dates, status) {
  if (!Array.isArray(dates) || dates.length === 0) {
    return { updated: 0, success: true };
  }
  if (typeof status !== 'string' || status.length === 0) {
    throw new Error('status must be a non-empty string');
  }

  // Turso/SQLite param cap ~999; chunk to be safe.
  const CHUNK = 500;
  let total = 0;

  for (let i = 0; i < dates.length; i += CHUNK) {
    const slice = dates.slice(i, i + CHUNK);
    const placeholders = slice.map(() => '?').join(',');
    const sql = `UPDATE tiktok_posts SET "Status" = ? WHERE "Date" IN (${placeholders})`;
    const result = await client.execute({
      sql,
      args: [status, ...slice],
    });
    total += result.rowsAffected ?? 0;
  }

  return { updated: total, success: true };
}

/* ------------------------------------------------------------------ */
/*  READ — summary view                                                */
/* ------------------------------------------------------------------ */

export async function getPostsSummary({ limit = 50, offset = 0 } = {}) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage", "Link"
    FROM tiktok_posts_summary
    ORDER BY "Likes" DESC
    LIMIT ? OFFSET ?
  `;
  const result = await client.execute({ sql, args: [limit, offset] });
  return rowsToObjects(result);
}

export async function getSummaryByDate(date) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage", "Link"
    FROM tiktok_posts_summary
    WHERE "Date" = ?
    LIMIT 1
  `;
  const result = await client.execute({ sql, args: [date] });
  const rows = rowsToObjects(result);
  return rows[0] ?? null;
}

export async function getTopLikedPosts(n = 10) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage", "Link"
    FROM tiktok_posts_summary
    ORDER BY "Likes" DESC
    LIMIT ?
  `;
  const result = await client.execute({ sql, args: [n] });
  return rowsToObjects(result);
}

/* ------------------------------------------------------------------ */
/*  COUNT                                                              */
/* ------------------------------------------------------------------ */

export async function countPosts() {
  const result = await client.execute(
    `SELECT COUNT(*) AS total FROM tiktok_posts`
  );
  return Number(result.rows[0].total ?? 0);
}

export async function countSummaryRows() {
  const result = await client.execute(
    `SELECT COUNT(*) AS total FROM tiktok_posts_summary`
  );
  return Number(result.rows[0].total ?? 0);
}

export async function countPostsWithMinLikes(minLikes = 0) {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM tiktok_posts WHERE "Likes" >= ?`,
    args: [minLikes],
  });
  return Number(result.rows[0].total ?? 0);
}

export async function clearAllPosts() {
  const result = await client.execute("DELETE FROM tiktok_posts");
  return {
    deleted: result.rowsAffected ?? 0,
    success: true,
  };
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/* ------------------------------------------------------------------ */
/*  HTTP HANDLER — RPC over one endpoint                               */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    if (req.method === 'POST') {
      const { action, payload = {} } = req.body ?? {};

      switch (action) {
        case 'insertPost': {
          if (!payload.post || typeof payload.post !== 'object') {
            return res.status(400).json({ error: 'payload.post is required' });
          }
          const result = await insertPosts(payload.post);
          return res.status(200).json({ inserted: 1, lastInsertRowid: result.lastInsertRowid ?? null });
        }

        case 'insertBulkPosts': {
          if (!Array.isArray(payload.posts)) {
            return res.status(400).json({ error: 'payload.posts must be an array' });
          }
          const result = await insertBulkPosts(payload.posts);
          return res.status(200).json({ result, inserted: payload.posts.length });
        }

        case 'updatePostsStatusByDates': {
          const { dates, status } = payload;
          if (!Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({ error: 'payload.dates must be a non-empty array' });
          }
          if (typeof status !== 'string' || status.length === 0) {
            return res.status(400).json({ error: 'payload.status must be a non-empty string' });
          }
          const result = await updatePostsStatusByDates(dates, status);
          return res.status(200).json(result);
        }

        default:
          return res.status(400).json({ error: `Unknown POST action: ${action}` });
      }
    }

    if (req.method === 'GET') {
      const action = req.query.action;

      switch (action) {
        case 'getPostsSummary': {
          const limit  = clamp(Number(req.query.limit  ?? 50), 1, 3000);
          const offset = Math.max(Number(req.query.offset ?? 0), 0);
          const result = await getPostsSummary({ limit, offset });
          return res.status(200).json({ result });
        }

        case 'getSummaryByDate': {
          const date = req.query.date;
          if (!date) {
            return res.status(400).json({ error: 'query.date is required' });
          }
          const result = await getSummaryByDate(date);
          return res.status(200).json({ result });
        }

        case 'getTopLikedPosts': {
          const n = clamp(Number(req.query.n ?? 10), 1, 3000);
          const result = await getTopLikedPosts(n);
          return res.status(200).json({ result });
        }

        case 'countPosts': {
          const result = await countPosts();
          return res.status(200).json({ result });
        }

        case 'countSummaryRows': {
          const result = await countSummaryRows();
          return res.status(200).json({ result });
        }

        /* ---------------- DELETE --------------- */
        case "clearAllPosts": {
          const result = await clearAllPosts();
          return res.status(200).json({ ok: true, ...result });
        }

        case 'countPostsWithMinLikes': {
          const min = Number(req.query.minLikes ?? 0);
          const result = await countPostsWithMinLikes(min);
          return res.status(200).json({ result });
        }

        default:
          return res.status(400).json({ error: `Unknown GET action: ${action}` });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/turos error:', err);
    return res.status(500).json({ error: err.message });
  }
}
