import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = resolve(ROOT, '.env');

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z_]+)="(.*)"/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

function envVal(key: string, fallback: string): string {
  return process.env[key] || readEnv()[key] || fallback;
}

export const config = {
  port: Number(envVal('PORT', '3001')),
  host: envVal('HOST', '0.0.0.0'),
  dbPath: envVal('DB_PATH', './data/simu-xiuxian.db'),
  qqBotAppId: envVal('QQ_BOT_APP_ID', ''),
  qqBotAppSecret: envVal('QQ_BOT_APP_SECRET', ''),
} as const;

export const llmConfig = {
  get baseUrl() { return envVal('LLM_BASE_URL', 'https://openrouter.ai/api/v1'); },
  get apiKey() { return envVal('LLM_API_KEY', ''); },
  get model() { return envVal('LLM_MODEL', 'deepseek/deepseek-chat'); },
};
