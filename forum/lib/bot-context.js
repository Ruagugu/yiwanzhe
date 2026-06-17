const db = require('../db');
const { getWorldSummary } = require('./world-setting');
const { getMemoriesForContext } = require('./npc-memory');
const { getWorldBookForContext } = require('./world-book');

function gatherContext(bot) {
  const now = new Date();

  const topics = db.prepare(`
    SELECT t.*, u.username, u.nickname, u.char_name, c.name as category_name,
      (SELECT COUNT(*) FROM posts WHERE topic_id = t.id) as reply_count
    FROM topics t
    JOIN users u ON u.id = t.user_id
    JOIN categories c ON c.id = t.category_id
    WHERE t.created_at >= datetime('now', '-4 hours')
    ORDER BY reply_count DESC, t.created_at DESC
    LIMIT 20
  `).all();

  const topicsWithReplies = topics.map(t => {
    const topReplies = db.prepare(`
      SELECT p.*, u.username, u.nickname, u.char_name
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.topic_id = ? AND p.parent_id IS NULL
      ORDER BY p.created_at DESC
      LIMIT 15
    `).all(t.id);
    const withChildren = topReplies.reverse().map(r => {
      const subs = db.prepare(`
        SELECT p.*, u.username, u.nickname, u.char_name
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.parent_id = ?
        ORDER BY p.created_at ASC
        LIMIT 10
      `).all(r.id);
      return { ...r, subs };
    });
    return { ...t, replies: withChildren };
  });

  const dms = db.prepare(`
    SELECT m.*, u.username as sender_name, u.char_name as sender_char
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.receiver_id = ? AND m.created_at >= datetime('now', '-24 hours')
    ORDER BY m.created_at DESC
  `).all(bot.user_id);

  const mentions = bot.char_name ? db.prepare(`
    SELECT p.*, u.username, u.char_name, t.title as topic_title, t.id as topic_id
    FROM posts p
    JOIN users u ON u.id = p.user_id
    JOIN topics t ON t.id = p.topic_id
    WHERE p.created_at >= datetime('now', '-24 hours')
      AND p.content LIKE '%' || ? || '%'
    ORDER BY p.created_at DESC
    LIMIT 30
  `).all(bot.char_name) : [];

  // 中国时区显示 + ISO + 友好时间 + 距倒置的暴雨的年数
  const cn = new Date(now.getTime() + 8 * 3600 * 1000);
  const pad = n => n < 10 ? '0' + n : '' + n;
  const WEEKDAYS = ['日','一','二','三','四','五','六'];
  const cnStr = `${cn.getUTCFullYear()}-${pad(cn.getUTCMonth()+1)}-${pad(cn.getUTCDate())} 周${WEEKDAYS[cn.getUTCDay()]} ${pad(cn.getUTCHours())}:${pad(cn.getUTCMinutes())}`;
  const yearsSince = cn.getUTCFullYear() - 1999;
  const hour = cn.getUTCHours();

  let ctx = `# 当前现实时间\n${cnStr}（北京时间，2026 年是【倒置的暴雨】后第 ${yearsSince} 年）\nISO: ${now.toISOString()}\n`;
  if (hour >= 0 && hour < 6) ctx += `时段：深夜 —— 传说生物与异域事件的高发期。\n`;
  else if (hour >= 6 && hour < 12) ctx += `时段：上午 —— 城市苏醒，普通人通勤。\n`;
  else if (hour >= 12 && hour < 18) ctx += `时段：下午 —— 适合调查、走访。\n`;
  else if (hour >= 18 && hour < 22) ctx += `时段：傍晚 —— 论坛活跃度上升。\n`;
  else ctx += `时段：夜晚 —— 都市的另一面开始显现。\n`;
  ctx += '\n';
  ctx += `# 你的身份\n你是「${bot.nickname || bot.char_name || bot.username}」`;
  if (bot.legend_name) ctx += `—— ${bot.legend_name}`;
  if (bot.criterion) ctx += `，准则「${bot.criterion}」`;
  ctx += `。\n你是一个真实存在于这个都市传说论坛中的角色，你有自己的性格、经历和立场。你不是AI，你就是你自己。\n\n`;

  // 注入世界观概要（动态从数据库读取，管理员可在后台修改）
  ctx += `# 世界观常识（你已掌握的公共知识）\n${getWorldSummary()}\n\n`;

  // 注入世界书：用 bot 当前看到的论坛内容作为扫描文本，命中关键词或常驻条目才注入
  const scanParts = [];
  for (const t of topicsWithReplies) {
    scanParts.push(t.title, t.content);
    for (const r of t.replies) {
      scanParts.push(r.content);
      if (r.subs) for (const s of r.subs) scanParts.push(s.content);
    }
  }
  for (const m of dms) scanParts.push(m.content);
  for (const m of mentions) scanParts.push(m.content);
  const scanText = scanParts.filter(Boolean).join('\n');
  ctx += getWorldBookForContext(bot.user_id, scanText);

  // 注入 NPC 长期记忆
  ctx += getMemoriesForContext(bot.user_id);

  // 注入新闻公告（全部历史新闻，bot 应该了解官方动向）
  const allNews = db.prepare(`
    SELECT n.*, u.username, u.nickname, u.char_name
    FROM news n JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC
    LIMIT 20
  `).all();
  ctx += `# 官方新闻与公告（来自 WCSC 通告频道）\n`;
  if (allNews.length === 0) {
    ctx += `（暂无新闻）\n`;
  } else {
    for (const n of allNews) {
      ctx += `## [新闻 #${n.id}] ${n.title}\n`;
      ctx += `发布者: @${n.username}${n.nickname && n.nickname !== n.username ? ' (' + n.nickname + ')' : ''}${n.char_name ? ' (' + n.char_name + ')' : ''} | ${n.created_at}\n`;
      if (n.cover) ctx += `配图: ${n.cover}\n`;
      ctx += `正文: ${n.content.slice(0, 500)}${n.content.length > 500 ? '…' : ''}\n\n`;
    }
  }
  ctx += '\n';

  ctx += `# 活跃帖子\n`;
  if (topicsWithReplies.length === 0) {
    ctx += `（暂无活跃帖子）\n`;
  } else {
    for (const t of topicsWithReplies) {
      ctx += `## [话题 #${t.id}] ${t.title} — ${t.category_name}\n`;
      ctx += `作者: @${t.username}${t.char_name ? ' (' + t.char_name + ')' : ''} | ${t.created_at} | ${t.reply_count} 回复\n`;
      ctx += `内容: ${t.content.slice(0, 300)}${t.content.length > 300 ? '…' : ''}\n`;
      if (t.replies.length > 0) {
        ctx += `最近回复:\n`;
        for (const r of t.replies) {
          ctx += `  - [回复#${r.id}] @${r.username}${r.nickname && r.nickname !== r.username ? ' (' + r.nickname + ')' : ''}${r.char_name ? ' (' + r.char_name + ')' : ''}: ${r.content.slice(0, 200)}${r.content.length > 200 ? '…' : ''} [${r.created_at}]\n`;
          if (r.subs && r.subs.length > 0) {
            for (const s of r.subs) {
              ctx += `      └ [回复#${s.id}] @${s.username}${s.nickname && s.nickname !== s.username ? ' (' + s.nickname + ')' : ''}${s.char_name ? ' (' + s.char_name + ')' : ''}: ${s.content.slice(0, 150)}${s.content.length > 150 ? '…' : ''} [${s.created_at}]\n`;
            }
          }
        }
        ctx += `（如需在某条回复下盖楼，reply 时把 parent_id 设为对应的 [回复#xxx] 编号）\n`;
      }
      ctx += '\n';
    }
  }

  ctx += `# 你的私信\n`;
  if (dms.length === 0) {
    ctx += `（暂无新私信）\n`;
  } else {
    for (const m of dms) {
      const senderName = m.sender_char || m.sender_name;
      ctx += `@${m.sender_name}（${senderName}）: "${m.content.slice(0, 300)}" [${m.created_at}]\n`;
    }
  }

  if (mentions.length > 0) {
    ctx += `\n# 有人提到了你\n`;
    for (const m of mentions) {
      ctx += `- [话题 #${m.topic_id} "${m.topic_title}"] @${m.username}: ${m.content.slice(0, 200)} [${m.created_at}]\n`;
    }
  }

  return ctx;
}

module.exports = { gatherContext };
