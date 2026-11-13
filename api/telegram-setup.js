// One-time webhook setup. POST with Authorization: Bearer <TELEGRAM_SETUP_KEY>.
// Required env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_SETUP_KEY.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const expected = process.env.TELEGRAM_SETUP_KEY;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return res.status(503).json({ ok: false, error: "Telegram bot settings are missing" });

  const webhookUrl = "https://candy-is-live-1.vercel.app/api/telegram-webhook";
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ["chat_member", "chat_join_request"],
        drop_pending_updates: false
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) return res.status(502).json({ ok: false, error: "Telegram rejected webhook setup" });
    return res.status(200).json({ ok: true, webhook_configured: true, allowed_updates: ["chat_member", "chat_join_request"] });
  } catch (_) {
    return res.status(502).json({ ok: false, error: "Could not contact Telegram" });
  }
};
