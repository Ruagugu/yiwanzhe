const db = require('../db');

const MAX_ACTIONS_PER_HOUR = 12;
const MIN_CONTENT_LENGTH = 10;
const MAX_CONTENT_LENGTH = 2000;
const VALID_ACTIONS = ['post_topic', 'reply', 'dm', 'follow', 'idle'];

function validateAction(bot, decision) {
  const { action } = decision;

  if (action === 'idle') return { ok: true };

  if (!VALID_ACTIONS.includes(action)) {
    return { ok: false, error: `Unknown action: ${action}` };
  }

  if (['post_topic', 'reply', 'dm'].includes(action)) {
    const content = decision.content || '';
    if (content.length < MIN_CONTENT_LENGTH) {
      return { ok: false, error: `Content too short (min ${MIN_CONTENT_LENGTH}, got ${content.length})` };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `Content too long (max ${MAX_CONTENT_LENGTH}, got ${content.length})` };
    }
  }

  if (action === 'post_topic') {
    if (!decision.category_id) {
      return { ok: false, error: 'post_topic requires category_id' };
    }
    if (!decision.title || decision.title.trim().length === 0) {
      return { ok: false, error: 'post_topic requires title' };
    }
  }

  if (action === 'reply') {
    if (!decision.topic_id) {
      return { ok: false, error: 'reply requires topic_id' };
    }
  }

  if (action === 'dm') {
    if (!decision.receiver_username) {
      return { ok: false, error: 'dm requires receiver_username' };
    }
  }

  const recentCount = db.prepare(`
    SELECT COUNT(*) as c FROM bot_action_logs
    WHERE bot_id = ? AND action != 'idle' AND error = ''
    AND created_at >= datetime('now', '-1 hour')
  `).get(bot.id).c;
  if (recentCount >= MAX_ACTIONS_PER_HOUR) {
    return { ok: false, error: `Rate limit hit: ${recentCount}/${MAX_ACTIONS_PER_HOUR} per hour` };
  }

  return { ok: true };
}

module.exports = { validateAction };
