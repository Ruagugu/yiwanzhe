const express = require('express');
const router = express.Router();
const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

router.get('/', requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT n.*, u.username, u.nickname, u.role, t.title as topic_title
    FROM notifications n
    JOIN users u ON u.id = n.from_user_id
    LEFT JOIN topics t ON t.id = n.topic_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all(req.session.user.id);

  // mark all as read on visit
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.session.user.id);

  res.render('notifications/index', { notifications });
});

module.exports = router;
