export interface TelegramSendOptions {
  botToken: string;
  chatId: string;
  message: string;
  disableNotification?: boolean;
}

/**
 * Sends a message via Telegram Bot API with automatic retries, timeout handling, and markdown fallback.
 */
export async function sendTelegramMessage(
  options: TelegramSendOptions,
  maxRetries = 3
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const { botToken, chatId, message, disableNotification } = options;

  if (!botToken || !chatId) {
    return { ok: false, description: 'Telegram bot token or chat ID is missing.' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000), // 15s timeout
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_notification: !!disableNotification,
        }),
      });

      const data = (await response.json()) as { ok: boolean; description?: string; result?: unknown };

      // If markdown formatting caused an error (e.g. unescaped characters), retry once in plain text
      if (!data.ok && data.description && data.description.toLowerCase().includes('parse')) {
        const plainResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            chat_id: chatId,
            text: message.replace(/[*_`]/g, ''),
            disable_notification: !!disableNotification,
          }),
        });
        return (await plainResponse.json()) as { ok: boolean; description?: string; result?: unknown };
      }

      if (data.ok) {
        return data;
      }

      lastError = data.description || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 2s, 4s, 8s
      const delayMs = attempt * 2000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    ok: false,
    description: `Failed after ${maxRetries} attempts: ${lastError}`,
  };
}

export async function verifyTelegramCredentials(
  botToken: string,
  chatId: string
): Promise<{ ok: boolean; botName?: string; error?: string }> {
  try {
    const meUrl = `https://api.telegram.org/bot${botToken}/getMe`;
    const meRes = await fetch(meUrl, { signal: AbortSignal.timeout(10000) });
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
  sessionName?: string;
  sessionId?: string;
  remainingMinutes: number;
  remainingSeconds: number;
  ttlLabel: string;
}): string {
  const { project, sessionName, sessionId, remainingMinutes, remainingSeconds, ttlLabel } = opts;

  let msg = `⚠️ *Claude Code Prompt Cache Expiring Soon!*\n\n`;
  if (project) {
    msg += `📁 *Project:* \`${project}\`\n`;
  }

  const displaySession = sessionName || (sessionId ? sessionId.slice(0, 8) : undefined);
  if (displaySession) {
    msg += `💬 *Session:* \`${displaySession}\`\n`;
  }

  const timeStr = remainingMinutes > 0 ? `~${remainingMinutes}m` : `${remainingSeconds}s`;
  msg += `⏳ *Time Remaining:* *${timeStr}* (of ${ttlLabel} cache TTL)\n\n`;
  msg += `💬 _Send a quick reply to your session to refresh the prompt cache and keep fast response times._`;

  return msg;
}
