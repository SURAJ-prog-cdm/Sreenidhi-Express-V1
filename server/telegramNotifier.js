// Sreenidhi TransitPulse - Free Telegram Bot Parent Alert Gateway (₹0 Cost)
// Sends instant messages to parents via official Telegram Bot API (https://core.telegram.org/bots/api)

export async function sendTelegramAlert(chatId, messageHtml) {
  // Read token dynamically when sending so static import order does not miss loaded .env settings
  const token = process.env.TELEGRAM_BOT_TOKEN || '';

  if (!token) {
    console.log(`[TelegramNotifier Sandbox] (No TELEGRAM_BOT_TOKEN set in env)`);
    console.log(`To Chat ID: ${chatId || 'UNLINKED'}`);
    console.log(`Message: ${messageHtml}`);
    return {
      success: true,
      mode: 'SANDBOX_LOG',
      message: 'Logged to console (Set TELEGRAM_BOT_TOKEN in .env for live Telegram push)',
    };
  }

  if (!chatId) {
    return {
      success: false,
      mode: 'UNLINKED_CHAT',
      error: 'Parent has not linked their Telegram Chat ID yet.',
    };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageHtml,
        parse_mode: 'HTML',
      }),
    });

    const data = await res.json();
    if (data.ok) {
      console.log(`[TelegramNotifier] Live parent alert delivered to chat ${chatId}`);
      return { success: true, mode: 'LIVE_DELIVERED', data };
    } else {
      console.warn(`[TelegramNotifier] Telegram API error:`, data);
      return { success: false, mode: 'API_ERROR', error: data.description };
    }
  } catch (err) {
    console.error(`[TelegramNotifier] Network exception:`, err);
    return { success: false, mode: 'NETWORK_ERROR', error: String(err) };
  }
}
