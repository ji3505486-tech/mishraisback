// Telegram v2 webhook: aggregate member counts plus consented, invite-linked Meta CAPI events.
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET_V2;
  const supplied = String(req.headers["x-telegram-bot-api-secret-token"] || "");
  if (!expected || supplied.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(401).json({ ok: false, error: "Unauthorized webhook" });
  }

  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!channelId || !redisUrl || !redisToken) {
    return res.status(503).json({ ok: false, error: "Tracking configuration missing" });
  }

  async function redis(parts) {
    const r = await fetch(redisUrl.replace(/\/$/, "") + "/" + parts.map(encodeURIComponent).join("/"), {
      headers: { Authorization: "Bearer " + redisToken }
    });
    if (!r.ok) throw new Error("Redis unavailable");
    const j = await r.json();
    if (j.error) throw new Error("Redis command failed");
    return j.result;
  }

  const update = req.body || {};
  if (update.update_id === undefined) return res.status(400).json({ ok: false, error: "Missing update_id" });

  try {
    const day = new Date().toISOString().slice(0, 10);
    let eventType = null;
    let acceptedUpdate = false;

    if (update.chat_join_request &&
        String(update.chat_join_request.chat && update.chat_join_request.chat.id) === String(channelId)) {
      eventType = "join_requests";
    } else if (update.chat_member &&
        String(update.chat_member.chat && update.chat_member.chat.id) === String(channelId)) {
      const oldStatus = update.chat_member.old_chat_member || {};
      const newStatus = update.chat_member.new_chat_member || {};
      const isMember = (m) => ["creator", "administrator", "member"].includes(m.status) ||
        (m.status === "restricted" && m.is_member === true);
      if (!isMember(oldStatus) && isMember(newStatus)) {
        eventType = "accepted_joins";
        acceptedUpdate = true;
      } else if (isMember(oldStatus) && !isMember(newStatus)) eventType = "leaves";
    }

    // Count each Telegram update once. CAPI has a separate retry-safe idempotency key.
    const countKey = "tg:v2:update:" + update.update_id;
    const counted = await redis(["SET", countKey, "1", "EX", "2592000", "NX"]);
    if (counted === "OK" && eventType) {
      const key = "tg:v2:daily:" + day + ":" + eventType;
      await redis(["INCR", key]);
      await redis(["EXPIRE", key, "7776000"]);
      await redis(["INCR", "tg:v2:total:" + eventType]);
      await redis(["LPUSH", "tg:v2:recent", JSON.stringify({ type: eventType, date: day, at: new Date().toISOString() })]);
      await redis(["LTRIM", "tg:v2:recent", "0", "49"]);
    }

    let capi = "not_applicable";
    let metaHttpStatus = null;
    let metaEventsReceived = null;
    let metaErrorCode = null;
    if (acceptedUpdate) {
      const inviteLink = update.chat_member.invite_link && update.chat_member.invite_link.invite_link;
      if (inviteLink && process.env.META_CAPI_ACCESS_TOKEN && process.env.META_PIXEL_ID) {
        const inviteKey = "tg:v2:invite:" + crypto.createHash("sha256").update(inviteLink).digest("hex");
        const raw = await redis(["GET", inviteKey]);
        let attribution = null;
        try { attribution = raw ? JSON.parse(raw) : null; } catch (_) {}
        if (attribution && attribution.consent === true && (attribution.fbp || attribution.fbc)) {
          const capiKey = "tg:v2:capi:" + update.update_id;
          const alreadySent = await redis(["GET", capiKey]);
          if (alreadySent === "1") {
            capi = "already_sent";
          } else {
            const userData = {};
            if (attribution.fbp) userData.fbp = attribution.fbp;
            if (attribution.fbc) userData.fbc = attribution.fbc;
            if (attribution.client_user_agent) userData.client_user_agent = attribution.client_user_agent;
            const mode = process.env.META_CAPI_MODE || "";
            const testCode = process.env.META_TEST_EVENT_CODE || "";
            if (mode !== "test" && mode !== "live") {
              capi = "capi_mode_not_configured";
            } else if (mode === "test" && !testCode) {
              capi = "test_event_code_missing";
            } else {
            const event = {
              event_name: "CompleteRegistration",
              event_time: Number(update.chat_member.date) || Math.floor(Date.now() / 1000),
              event_id: "tg-accepted-" + String(update.update_id),
              action_source: "website",
              event_source_url: "https://candy-is-live-1.vercel.app/",
              user_data: userData
            };
            const payload = { data: [event] };
            if (mode === "test") payload.test_event_code = testCode;
            const version = process.env.META_GRAPH_API_VERSION || "v26.0";
            const endpoint = "https://graph.facebook.com/" + version + "/" +
              encodeURIComponent(process.env.META_PIXEL_ID) + "/events?access_token=" +
              encodeURIComponent(process.env.META_CAPI_ACCESS_TOKEN);
            const meta = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const metaResult = await meta.json().catch(() => ({}));
            metaHttpStatus = meta.status;
            metaEventsReceived = Number.isFinite(Number(metaResult.events_received)) ? Number(metaResult.events_received) : null;
            metaErrorCode = metaResult.error && metaResult.error.code ? metaResult.error.code : null;
            if (!meta.ok || metaResult.error) {
              capi = "send_failed";
            } else {
              await redis(["SET", capiKey, "1", "EX", "7776000"]);
              capi = "sent";
            }
            }
          }
        } else {
          capi = "no_consent_attribution";
        }
      } else {
        capi = "no_invite_or_capi_config";
      }
    }

    console.info("telegram_webhook_v2_result", JSON.stringify({ update_id: update.update_id, type: eventType, accepted: acceptedUpdate, capi, meta_http_status: metaHttpStatus, meta_events_received: metaEventsReceived, meta_error_code: metaErrorCode }));
    if (capi === "send_failed") return res.status(503).json({ ok: false, tracked: Boolean(eventType), type: eventType, capi });
    return res.status(200).json({ ok: true, tracked: Boolean(eventType), type: eventType, capi });
  } catch (_) {
    return res.status(503).json({ ok: false, error: "Tracking storage temporarily unavailable" });
  }
};
