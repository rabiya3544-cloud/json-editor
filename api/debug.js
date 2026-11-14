// api/debug.js
import { client, countPosts, countSummaryRows } from './turso.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [posts, summary] = await Promise.all([
      countPosts(),
      countSummaryRows(),
    ]);
    return res.status(200).json({
      tiktok_posts: posts,
      tiktok_posts_summary: summary,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
