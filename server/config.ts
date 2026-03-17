export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/simu-xiuxian.db',
  qqBotAppId: process.env.QQ_BOT_APP_ID ?? '',
  qqBotAppSecret: process.env.QQ_BOT_APP_SECRET ?? '',
} as const;

/** Mutable LLM config — can be updated at runtime via POST /api/config/llm */
export const llmConfig = {
  baseUrl: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
  apiKey: process.env.LLM_API_KEY ?? '',
  model: process.env.LLM_MODEL ?? 'deepseek/deepseek-chat',
};
