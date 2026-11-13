import { createClient } from "@tursodatabase/serverless/compat";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export { client };

/* ------------------------------------------------------------------ */
/*  WRITE                                                              */
/* ------------------------------------------------------------------ */

/**
 * Inserts a single TikTok post.
 * @param {Object} post
 */
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
    post.Likes ?? 0,
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

/**
 * Inserts multiple TikTok posts in a single transactional batch.
 * @param {Object[]} posts
 */
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
      post.Likes ?? 0,
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
/*  READ — summary view                                               */
/* ------------------------------------------------------------------ */

/**
 * Returns rows from the tiktok_posts_summary view, ordered by Likes DESC.
 * Supports optional pagination.
 *
 * @param {Object}  [opts]
 * @param {number}  [opts.limit=50]
 * @param {number}  [opts.offset=0]
 * @returns {Promise<{Date:string, Likes:number, CoverImage:string}[]>}
 */
export async function getPostsSummary({ limit = 50, offset = 0 } = {}) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage"
    FROM tiktok_posts_summary
    ORDER BY "Likes" DESC
    LIMIT ? OFFSET ?
  `;
  const result = await client.execute({ sql, args: [limit, offset] });
  return result.rows;
}

/**
 * Returns a single summary row filtered by exact Date.
 * @param {string} date
 */
export async function getSummaryByDate(date) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage"
    FROM tiktok_posts_summary
    WHERE "Date" = ?
    LIMIT 1
  `;
  const result = await client.execute({ sql, args: [date] });
  return result.rows[0] ?? null;
}

/**
 * Returns the N most-liked posts from the view (shortcut).
 * @param {number} [n=10]
 */
export async function getTopLikedPosts(n = 10) {
  const sql = `
    SELECT "Date", "Likes", "CoverImage"
    FROM tiktok_posts_summary
    ORDER BY "Likes" DESC
    LIMIT ?
  `;
  const result = await client.execute({ sql, args: [n] });
  return result.rows;
}

/* ------------------------------------------------------------------ */
/*  COUNT                                                              */
/* ------------------------------------------------------------------ */

/**
 * Total number of rows in tiktok_posts.
 * @returns {Promise<number>}
 */
export async function countPosts() {
  const result = await client.execute(
    `SELECT COUNT(*) AS total FROM tiktok_posts`
  );
  return Number(result.rows[0].total ?? 0);
}

/**
 * Total rows in the summary view (identical count today, but kept
 * separate so it survives future view changes).
 * @returns {Promise<number>}
 */
export async function countSummaryRows() {
  const result = await client.execute(
    `SELECT COUNT(*) AS total FROM tiktok_posts_summary`
  );
  return Number(result.rows[0].total ?? 0);
}

/**
 * Count of posts whose Likes >= a threshold.
 * @param {number} minLikes
 * @returns {Promise<number>}
 */
export async function countPostsWithMinLikes(minLikes = 0) {
  const result = await client.execute({
    sql: `SELECT COUNT(*) AS total FROM tiktok_posts WHERE "Likes" >= ?`,
    args: [minLikes],
  });
  return Number(result.rows[0].total ?? 0);
}
