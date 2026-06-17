const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

// 读取全局 API 配置作为兜底
function getGlobalCreds() {
  try {
    const key = db.prepare("SELECT value FROM settings WHERE key = 'global_api_key'").get();
    const base = db.prepare("SELECT value FROM settings WHERE key = 'global_api_base'").get();
    return { key: key?.value || '', base: base?.value || '' };
  } catch (e) {
    return { key: '', base: '' };
  }
}

const DECIDE_ACTION_TOOL = {
  name: 'decide_action',
  description: '基于论坛上下文，决定下一次互动动作。如果没什么可做的或刚做过类似动作，选择 idle 让其他角色也有机会。',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['post_topic', 'reply', 'dm', 'follow', 'idle'], description: '要执行的动作类型' },
      category_id: { type: 'number', description: '发帖时必填。可用分类 ID：1=情报交换, 2=委托发布, 3=知识共享, 4=匿名社交, 5=日常分享。6=WCSC通告 仅管理员可发，你不要选它。' },
      title: { type: 'string', description: '帖子标题，发帖时必填，10-100字' },
      topic_id: { type: 'number', description: '要回复的帖子ID，回复时必填' },
      parent_id: { type: 'number', description: '回复时选填。若要回复某条楼中楼/某个具体的回复（即在该回复下盖楼），填该回复的ID（上下文中标注为 [回复#xxx]）。留空则为对主楼的普通回复。' },
      receiver_username: { type: 'string', description: '收信人用户名（不含@），发私信或关注时必填' },
      content: { type: 'string', description: '正文内容，发帖/回复/私信时必填。保持角色一致性，10-2000字' },
      reason: { type: 'string', description: '简短说明为什么做这个决定（1-2句话）' }
    },
    required: ['action', 'reason']
  }
};

// 把全局 key/base 合并到 bot 上（如果 bot 自身未配置）
function resolveCreds(bot) {
  const g = getGlobalCreds();
  return {
    apiKey: bot.api_key || g.key,
    apiBase: bot.api_base || g.base
  };
}

function detectAPI(apiBase) {
  const base = (apiBase || '').toLowerCase();
  if (base.includes('deepseek')) return 'openai';
  if (base.includes('openai')) return 'openai';
  if (base.includes('anthropic')) return 'anthropic';
  if (base.includes('claude')) return 'anthropic';
  return 'openai';
}

async function callOpenAI(bot, contextText) {
  const { apiKey, apiBase } = resolveCreds(bot);
  if (!apiBase) throw new Error('No API base configured (bot or global)');
  const base = apiBase.replace(/\/+$/, '');
  const url = base + '/chat/completions';

  const body = {
    model: bot.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: bot.system_prompt },
      { role: 'user', content: contextText }
    ],
    max_tokens: 2048,
    temperature: 0.9,
    tools: [{
      type: 'function',
      function: {
        name: 'decide_action',
        description: DECIDE_ACTION_TOOL.description,
        parameters: DECIDE_ACTION_TOOL.input_schema
      }
    }],
    tool_choice: 'auto'
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(resp.status + ' ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error('No choices in OpenAI response');

  // OpenAI tool_use 格式
  const toolCall = choice.message?.tool_calls?.[0];
  if (toolCall && toolCall.function) {
    try {
      return JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return { action: 'idle', reason: 'failed to parse tool_use args' };
    }
  }

  // 回退：解析文本中包含的 JSON
  const text = choice.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) { /* fall through */ }
  }

  return { action: 'idle', reason: 'no tool_use in response' };
}

async function callAnthropic(bot, contextText) {
  const { apiKey, apiBase } = resolveCreds(bot);
  if (!apiKey) throw new Error('No API key configured');
  const client = new Anthropic({
    apiKey: apiKey,
    baseURL: apiBase || undefined,
  });

  const msg = await client.messages.create({
    model: bot.model || 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: bot.system_prompt,
    messages: [{ role: 'user', content: contextText }],
    tools: [DECIDE_ACTION_TOOL],
    tool_choice: { type: 'tool', name: 'decide_action' },
    temperature: 0.9,
  });

  const toolBlock = msg.content.find(c => c.type === 'tool_use');
  if (!toolBlock) return { action: 'idle', reason: 'no tool_use in response' };

  return {
    action: toolBlock.input.action || 'idle',
    category_id: toolBlock.input.category_id,
    title: toolBlock.input.title,
    topic_id: toolBlock.input.topic_id,
    parent_id: toolBlock.input.parent_id,
    receiver_username: toolBlock.input.receiver_username,
    content: toolBlock.input.content,
    reason: toolBlock.input.reason || ''
  };
}

async function callLLM(bot, contextText) {
  const { apiKey, apiBase } = resolveCreds(bot);
  if (!apiKey) throw new Error('No API key configured for bot ' + bot.id + ' (set bot or global)');
  if (!apiBase) throw new Error('No API base configured for bot ' + bot.id + ' (set bot or global)');

  const apiType = detectAPI(apiBase);

  let decision;
  if (apiType === 'anthropic') {
    decision = await callAnthropic(bot, contextText);
  } else {
    decision = await callOpenAI(bot, contextText);
  }

  return {
    action: decision.action || 'idle',
    category_id: decision.category_id,
    title: decision.title,
    topic_id: decision.topic_id,
    parent_id: decision.parent_id,
    receiver_username: decision.receiver_username,
    content: decision.content,
    reason: decision.reason || ''
  };
}

module.exports = { callLLM, DECIDE_ACTION_TOOL };
