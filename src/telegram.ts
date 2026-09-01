export interface TelegramSendOptions {
  botToken: string;
  chatId: string;
  message: string;
  disableNotification?: boolean;
}

export async function sendTelegramMessage(options: TelegramSendOptions): Promise<{ ok: boolean; description?: string }> {
  const { botToken, chatId, message, disableNotification } = options;

  if (!botToken || !chatId) {
    return { ok: false, description: 'Telegram bot token or chat ID is missing.' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_notification: !!disableNotification,
      }),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };
    return data;
  } catch (error) {
    return {
      ok: false,
      description: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function verifyTelegramCredentials(botToken: string, chatId: string): Promise<{ ok: boolean; botName?: string; error?: string }> {
  try {
    const meUrl = `https://api.telegram.org/bot${botToken}/getMe`;
    const meRes = await fetch(meUrl);
    const meData = (await meRes.json()) as { ok: boolean; result?: { username?: string }; description?: string };

    if (!meData.ok) {
      return { ok: false, error: meData.description || 'Invalid Bot Token' };
    }

    const testMsgRes = await sendTelegramMessage({
      botToken,
      chatId,
      message: '🔔 *cc-cache-alert* connected successfully!\nYou will receive prompt cache expiration warnings here.',
    });

    if (!testMsgRes.ok) {
      return { ok: false, error: `Bot verified, but could not send to chat: ${testMsgRes.description}` };
    }

    return { ok: true, botName: meData.result?.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function formatCacheAlertMessage(opts: {
  project?: string;
  sessionId?: string;
  remainingMinutes: number;
  remainingSeconds: number;
  ttlLabel: string;
}): string {
  const { project, sessionId, remainingMinutes, remainingSeconds, ttlLabel } = opts;

  let msg = `⚠️ *Claude Code Prompt Cache Expiring Soon!*\n\n`;
  if (project) {
    msg += `📁 *Project:* \`${project}\`\n`;
  }
  if (sessionId) {
    msg += `🆔 *Session:* \`${sessionId.slice(0, 8)}\`\n`;
  }

  const timeStr = remainingMinutes > 0 ? `~${remainingMinutes}m` : `${remainingSeconds}s`;
  msg += `⏳ *Time Remaining:* *${timeStr}* (of ${ttlLabel} cache TTL)\n\n`;
  msg += `💬 _Send a quick reply to your session to refresh the prompt cache and keep fast response times._`;

  return msg;
}
