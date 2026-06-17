const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const catData = categories.map(cat => {
    const topics = db.prepare(`
      SELECT t.*, u.username, u.nickname,
        (SELECT COUNT(*) FROM posts WHERE topic_id = t.id) as reply_count,
        (SELECT created_at FROM posts WHERE topic_id = t.id ORDER BY created_at DESC LIMIT 1) as last_reply_at
      FROM topics t JOIN users u ON t.user_id = u.id
      WHERE t.category_id = ?
      ORDER BY t.is_pinned DESC, t.created_at DESC LIMIT 5
    `).all(cat.id);
    const topicCount = db.prepare('SELECT COUNT(*) as c FROM topics WHERE category_id = ?').get(cat.id).c;
    return { ...cat, topics, topicCount };
  });
  res.render('index', { categories: catData });
});

module.exports = router;
