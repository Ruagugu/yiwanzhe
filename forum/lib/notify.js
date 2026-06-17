const db = require('../db');

// Parse @username OR @昵称 mentions in content and create notifications
// Resolve by checking both username and nickname columns
function notifyMentions(content, topicId, postId, senderId) {
  const mentions = [];
  const re = /(?<!\w)@([\w一-鿿-]{2,20})/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1];
    if (!mentions.includes(name)) mentions.push(name);
  }
  if (mentions.length === 0) return;

  // 先按 username 精确匹配，再按 nickname 精确匹配
  const matched = [];
  for (const name of mentions) {
    const byUsername = db.prepare('SELECT id, username FROM users WHERE username = ?').get(name);
    if (byUsername) { matched.push(byUsername); continue; }
    const byNickname = db.prepare("SELECT id, username FROM users WHERE nickname = ? AND nickname != ''").get(name);
    if (byNickname) { matched.push(byNickname); continue; }
  }

  if (matched.length === 0) return;

  const stmt = db.prepare(
    'INSERT INTO notifications (user_id, from_user_id, type, topic_id, post_id) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of matched) {
    if (u.id === senderId) continue; // skip self-mentions
    stmt.run(u.id, senderId, 'mention', topicId, postId);
  }
}

// Convert raw text with @mentions into display HTML (call at render time)
// 链接始终指向 /user/<username>
function formatContent(text) {
  let html = (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  html = html.replace(/\n/g, '<br>');
  // 找到所有 @文本，尝试解析为已知用户（username 或 nickname）
  html = html.replace(/(?<!\w)@([\w一-鿿-]{2,20})/g, (full, name) => {
    const u = db.prepare('SELECT username FROM users WHERE username = ? OR (nickname = ? AND nickname != \'\')').get(name, name);
    if (u) {
      return '<a class="mention-link" href="/user/' + u.username + '">@' + name + '</a>';
    }
    return '@' + name;
  });
  return html;
}

module.exports = { notifyMentions, formatContent };
