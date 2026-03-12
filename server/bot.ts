import { config } from './config.js';

export async function pushToQQ(text: string): Promise<boolean> {
  if (!config.onebotHttpUrl || !config.qqGroupId) {
    console.warn('[bot] ONEBOT_HTTP_URL or QQ_GROUP_ID not configured, skipping push');
    return false;
  }

  const url = `${config.onebotHttpUrl.replace(/\/+$/, '')}/send_group_msg`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.onebotToken) {
    headers['Authorization'] = `Bearer ${config.onebotToken}`;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ group_id: config.qqGroupId, message: text }),
    });

    if (!res.ok) {
      console.error(`[bot] push failed: HTTP ${res.status}`);
      return false;
    }

    console.log('[bot] push succeeded');
    return true;
  } catch (err) {
    console.error('[bot] push failed:', err);
    return false;
  }
}
