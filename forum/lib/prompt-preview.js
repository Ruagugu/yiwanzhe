// 拼装「即将发送给 LLM 的完整内容」用于预览。
// 不调真实 API，纯本地计算。
// 复用 lib/bot-context.js 的 gatherContext，保证与生产一致。
const { gatherContext } = require('./bot-context');
const { DECIDE_ACTION_TOOL } = require('./bot-llm');

function estimateTokens(s) {
  if (!s) return 0;
  return Math.ceil(String(s).length / 2);
}

function buildPrompt(bot) {
  // 1. system prompt
  const systemPrompt = bot.system_prompt || '';

  // 2. user message (gatherContext 拼装的运行时上下文)
  let userMessage = '';
  let userError = null;
  try {
    userMessage = gatherContext(bot) || '';
  } catch (e) {
    userError = e.message;
    userMessage = '<!-- context error: ' + e.message + ' -->';
  }

  // 3. tool definitions
  const tools = [{
    name: DECIDE_ACTION_TOOL.name,
    description: DECIDE_ACTION_TOOL.description,
    schema: DECIDE_ACTION_TOOL.input_schema,
  }];
  const toolsSerialized = (() => {
    try {
      return JSON.stringify(tools, null, 2);
    } catch (e) {
      return '<!-- tools serialization error: ' + e.message + ' -->';
    }
  })();

  // 4. token counts (本地估算: 字符数 / 2)
  const sysCount = estimateTokens(systemPrompt);
  const usrCount = estimateTokens(userMessage);
  const toolCount = estimateTokens(toolsSerialized);
  const total = sysCount + usrCount + toolCount;

  // 5. 完整 JSON 模拟（按 Anthropic 协议拼装，OpenAI 协议也类似但字段名不同）
  const fullRequest = {
    model: bot.model || 'claude-sonnet-4-6',
    max_tokens: 2048,
    temperature: 0.9,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: tools,
  };
  let fullRequestStr;
  try {
    fullRequestStr = JSON.stringify(fullRequest, null, 2);
  } catch (e) {
    fullRequestStr = '<!-- full request serialization error: ' + e.message + ' -->';
  }

  return {
    bot: {
      id: bot.id,
      display_name: bot.display_name,
      username: bot.username,
      nickname: bot.nickname,
      char_name: bot.char_name,
      legend_name: bot.legend_name,
      criterion: bot.criterion,
      model: bot.model,
      is_active: bot.is_active,
      activity_interval: bot.activity_interval,
    },
    systemPrompt,
    userMessage,
    userError,
    tools,
    toolsSerialized,
    fullRequestStr,
    counts: {
      system: sysCount,
      user: usrCount,
      tools: toolCount,
      total,
    },
  };
}

module.exports = { buildPrompt };
