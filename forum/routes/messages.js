const express = require('express');
const router = express.Router();
const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// 私信收件箱：按会话聚合，显示每个对话的最新一条 + 未读数
router.get('/', requireAuth, (req, res) => {
  const me = req.session.user.id;
  const conversations = db.prepare(`
    SELECT u.id, u.username, u.nickname, u.char_name, u.avatar, u.role,
      m.content as last_content, m.created_at as last_at, m.sender_id as last_sender,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread
    FROM (
      SELECT
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id,
        MAX(id) as max_id
      FROM messages
      WHERE sender_id = ? OR receiver_id = ?
      GROUP BY other_id
    ) conv
    JOIN messages m ON m.id = conv.max_id
    JOIN users u ON u.id = conv.other_id
    ORDER BY m.created_at DESC
  `).all(me, me, me, me);

  res.render('messages/inbox', { conversations });
});

// 与某人的对话线程
router.get('/:username', requireAuth, (req, res) => {
  const me = req.session.user.id;
  const other = db.prepare('SELECT id, username, nickname, char_name, avatar, role FROM users WHERE username = ?').get(req.params.username);
  if (!other) return res.render('error', { title: 'ERROR', message: 'USER NOT FOUND' });
  if (other.id === me) return res.redirect('/messages');

  const thread = db.prepare(`
    SELECT m.*, u.username as sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
  `).all(me, other.id, other.id, me);

  // 把对方发来的未读标记为已读
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0').run(other.id, me);

  res.render('messages/thread', { other, thread });
});

// 发送私信
router.post('/:username', requireAuth, (req, res) => {
  const me = req.session.user.id;
  const content = (req.body.content || '').trim();
  const other = db.prepare('SELECT id, username FROM users WHERE username = ?').get(req.params.username);
  if (!other || other.id === me || !content) return res.redirect(`/messages/${req.params.username}`);

  db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)').run(me, other.id, content);
  res.redirect(`/messages/${other.username}`);
});

module.exports = router;
