const db = require('../db');
const { gatherContext } = require('./bot-context');
const { callLLM } = require('./bot-llm');
const { validateAction } = require('./bot-guard');
const { notifyMentions } = require('./notify');

const MAX_CONCURRENT = 3;
let schedulerTimer = null;
const running = new Map();
const pending = [];

function startBotEngine() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(tick, 30000);
  console.log('[bot-engine] 已启动, 扫描间隔=30s, 并发上限=' + MAX_CONCURRENT);
}

function stopBotEngine() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  console.log('[bot-engine] 已停止');
}

function tick() {
  const bots = db.prepare(`
    SELECT b.*, u.username, u.nickname, u.char_name, u.legend_name, u.criterion
    FROM bots b JOIN users u ON u.id = b.user_id
    WHERE b.is_active = 1
      AND (b.last_action_at IS NULL
           OR datetime(b.last_action_at, '+' || b.activity_interval || ' seconds') < datetime('now'))
      AND u.role = 'bot'
  `).all();

  for (const bot of bots) {
    if (!running.has(bot.id) && !pending.some(p => p.id === bot.id)) {
      enqueue(bot);
    }
  }
}

function enqueue(bot) {
  if (running.size < MAX_CONCURRENT) {
    running.set(bot.id, true);
    run(bot).finally(() => dequeue(bot.id));
  } else {
    pending.push(bot);
  }
}

function dequeue(botId) {
  running.delete(botId);
  if (pending.length > 0 && running.size < MAX_CONCURRENT) {
    // 跳过已被禁用的 bot
    let next = null;
    while (pending.length > 0) {
      const candidate = pending.shift();
      const bot = db.prepare('SELECT is_active FROM bots WHERE id = ?').get(candidate.id);
      if (bot && bot.is_active) {
        next = candidate;
        break;
      }
    }
    if (next) {
      running.set(next.id, true);
      run(next).finally(() => dequeue(next.id));
    }
  }
}

function clearBotsFromQueue(botIds) {
  for (const id of botIds) {
    if (running.has(id)) running.delete(id);
  }
  for (let i = pending.length - 1; i >= 0; i--) {
    if (botIds.includes(pending[i].id)) pending.splice(i, 1);
  }
}

async function run(bot) {
  try {
    // 1. 收集上下文
    const ctx = gatherContext(bot);

    // 2. LLM 决策
    const decision = await callLLM(bot, ctx);

    // 3. 硬限制校验
    const check = validateAction(bot, decision);
    if (!check.ok) {
      logAction(bot.id, decision.action, decision, check.error);
      return;
    }

    // 4. 执行动作
    executeAction(bot, decision);

    // 5. 记录成功日志
    logAction(bot.id, decision.action, decision, '');
    console.log('[bot-engine] bot#' + bot.id + ' "' + bot.display_name + '" -> ' + decision.action + ': ' + decision.reason);

  } catch (err) {
    console.error('[bot-engine] bot#' + bot.id + ' error:', err.message);
    logAction(bot.id, 'error', {}, err.message);
  } finally {
    db.prepare("UPDATE bots SET last_action_at = datetime('now') WHERE id = ?").run(bot.id);
  }
}

function executeAction(bot, decision) {
  const { action } = decision;

  if (action === 'idle') return;

  if (action === 'post_topic') {
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(decision.category_id);
    if (!cat) throw new Error('Category not found: ' + decision.category_id);
    if (cat.post_role === 'admin') throw new Error('Category restricted to admin: ' + cat.name);
    db.prepare('INSERT INTO topics (title, content, category_id, user_id) VALUES (?, ?, ?, ?)')
      .run(decision.title.trim(), decision.content, decision.category_id, bot.user_id);
    const topicId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    notifyMentions(decision.content, topicId, null, bot.user_id);

  } else if (action === 'reply') {
    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(decision.topic_id);
    if (!topic) throw new Error('Topic not found: ' + decision.topic_id);
    if (topic.is_locked) throw new Error('Topic is locked: ' + decision.topic_id);

    // 楼中楼：校验 parent_id 合法性，保留直接父级以支持嵌套显示
    let parentId = null;
    if (decision.parent_id) {
      const parent = db.prepare('SELECT id, topic_id FROM posts WHERE id = ?').get(decision.parent_id);
      if (!parent) throw new Error('Parent post not found: ' + decision.parent_id);
      if (parent.topic_id !== topic.id) throw new Error('Parent post belongs to a different topic: ' + decision.parent_id);
      parentId = parent.id;
    }

    db.prepare('INSERT INTO posts (content, topic_id, user_id, parent_id) VALUES (?, ?, ?, ?)')
      .run(decision.content, decision.topic_id, bot.user_id, parentId);
    const postId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    notifyMentions(decision.content, decision.topic_id, postId, bot.user_id);

  } else if (action === 'dm') {
    const receiver = db.prepare('SELECT id FROM users WHERE username = ?').get(decision.receiver_username);
    if (!receiver) throw new Error('Receiver not found: ' + decision.receiver_username);
    if (receiver.id === bot.user_id) throw new Error('Cannot DM self');
    db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)')
      .run(bot.user_id, receiver.id, decision.content);

  } else if (action === 'follow') {
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(decision.receiver_username);
    if (!target) throw new Error('Target not found: ' + decision.receiver_username);
    if (target.id === bot.user_id) throw new Error('Cannot follow self');
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)')
      .run(bot.user_id, target.id);
  }
}

function logAction(botId, action, params, error) {
  db.prepare('INSERT INTO bot_action_logs (bot_id, action, params, reason, error) VALUES (?, ?, ?, ?, ?)')
    .run(botId, action, JSON.stringify(params), (params && params.reason) || '', error || '');
}

function cleanOldLogs() {
  const count = db.prepare('SELECT COUNT(*) as c FROM bot_action_logs').get().c;
  if (count > 500) {
    const cutoff = count - 500;
    db.prepare('DELETE FROM bot_action_logs WHERE id IN (SELECT id FROM bot_action_logs ORDER BY id ASC LIMIT ?)').run(cutoff);
  }
}
setInterval(cleanOldLogs, 3600000);

module.exports = { startBotEngine, stopBotEngine, run, clearBotsFromQueue };
