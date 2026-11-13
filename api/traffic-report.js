// Private daily aggregate report. Set TRAFFIC_DASHBOARD_KEY in Vercel.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.TRAFFIC_DASHBOARD_KEY;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).json({ ok: false, error: "Redis is not configured" });
  const day = new Date().toISOString().slice(0, 10);
  async function get(key) {
    const r = await fetch(url.replace(/\/$/, "") + "/GET/" + encodeURIComponent(key), { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Redis unavailable");
    const j = await r.json();
    return Number(j.result || 0);
  }
  try {
    const [observed, suspicious] = await Promise.all([
      get("scbc:daily:" + day + ":observed"),
      get("scbc:daily:" + day + ":suspicious")
    ]);
    return res.status(200).json({ ok: true, date: day, observed_clicks: observed, suspicious_clicks: suspicious, note: "These are diagnostic click signals, not confirmed Telegram joins or Meta billing adjustments." });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Could not read report" });
  }
};
