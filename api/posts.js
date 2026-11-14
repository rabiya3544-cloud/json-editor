// api/posts.js
import { insertBulkPosts, getPostsSummary, countPosts } from './turos.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const posts = req.body?.posts;
      if (!Array.isArray(posts)) {
        return res.status(400).json({ error: 'Body must be { posts: [...] }' });
      }
      await insertBulkPosts(posts);
      return res.status(200).json({ inserted: posts.length });
    }

    if (req.method === 'GET') {
      const limit = Number(req.query.limit ?? 50);
      const offset = Number(req.query.offset ?? 0);
      const [rows, total] = await Promise.all([
        getPostsSummary({ limit, offset }),
        countPosts(),
      ]);
      return res.status(200).json({ rows, total });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/posts error:', err);
    return res.status(500).json({ error: err.message });
  }
}
