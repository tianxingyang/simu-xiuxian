export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/simu-xiuxian.db',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  onebotHttpUrl: process.env.ONEBOT_HTTP_URL ?? '',
  onebotToken: process.env.ONEBOT_TOKEN ?? '',
  qqGroupId: Number(process.env.QQ_GROUP_ID ?? 0),
  reportCron: process.env.REPORT_CRON ?? '0 8 * * *',
} as const;
