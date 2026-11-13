// Protected daily/weekly/monthly Telegram membership report.
// Required env: TELEGRAM_DASHBOARD_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID,
// UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const expected = process.env.TELEGRAM_DASHBOARD_KEY;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!token || !channelId || !url || !redisToken) {
    return res.status(503).json({ ok: false, error: "Telegram report is not configured" });
  }

  async function redis(command) {
    const r = await fetch(url.replace(/\/$/, "") + "/" + command.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    if (!r.ok) throw new Error("Redis request failed");
    const j = await r.json();
    if (j.error) throw new Error("Redis command failed");
    return j.result;
  }
  async function telegram(method) {
    const r = await fetch("https://api.telegram.org/bot" + token + "/" + method);
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error("Telegram request failed");
    return j.result;
  }
  const dateKey = (d) => d.toISOString().slice(0, 10);
  try {
    const today = new Date();
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      return dateKey(d);
    });
    const rows = await Promise.all(days.map(async (day) => {
      const values = await Promise.all(["join_requests", "accepted_joins", "leaves"].map(async (kind) => {
        const value = await redis(["GET", "tg:daily:" + day + ":" + kind]);
        return Number(value || 0);
      }));
      return { date: day, join_requests: values[0], accepted_joins: values[1], leaves: values[2] };
    }));
    const sum = (n) => rows.slice(0, n).reduce((a, x) => ({
      join_requests: a.join_requests + x.join_requests,
      accepted_joins: a.accepted_joins + x.accepted_joins,
      leaves: a.leaves + x.leaves
    }), { join_requests: 0, accepted_joins: 0, leaves: 0 });
    const [members, recentRaw] = await Promise.all([
      telegram("getChatMemberCount?chat_id=" + encodeURIComponent(channelId)),
      redis(["LRANGE", "tg:recent_events", "0", "19"])
    ]);
    return res.status(200).json({
      ok: true,
      current_members: members,
      today: rows[0],
      last_7_days: sum(7),
      last_30_days: sum(30),
      daily: rows,
      recent_events: (recentRaw || []).map((x) => { try { return JSON.parse(x); } catch (_) { return null; } }).filter(Boolean),
      note: "Join requests are pending requests; accepted_joins count only Telegram membership status changes. Historical events are not backfilled."
    });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Could not load Telegram report" });
  }
};
