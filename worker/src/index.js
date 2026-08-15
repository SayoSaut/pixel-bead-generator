/**
 * 拼豆库存同步 Worker
 *
 * 一个极小的键值 API，让几个人的库存能跨设备同步。前端仍然托管在 GitHub
 * Pages 上，只有库存读写走这里。
 *
 * 认证用的是一个共享口令，而不是账号系统。对"就几个熟人"这个规模，账号
 * 系统的注册/找回/邮件发送等一整套东西的成本远大于它解决的问题。代价要
 * 说清楚：拿到口令的人能读写所有档案，所以别把它当成保护隐私的手段，也
 * 别把它写进公开仓库 —— 它是 Worker secret，前端由使用者自己填。
 *
 * 每个人一个 profile（档案名），数据存成 KV 里的 inventory:<profile>。
 *
 * 路由：
 *   GET  /api/profiles                  列出所有档案名
 *   GET  /api/inventory?profile=<名字>   读某个档案
 *   PUT  /api/inventory?profile=<名字>   写某个档案
 *   DELETE /api/inventory?profile=<名字> 删除档案
 */

const MAX_PROFILE_LEN = 24;
const MAX_CODES = 400;          // 完整色卡 291 色，留些余量
const MAX_COUNT = 1_000_000;

// 常量时间比较：避免用 === 逐字符短路，让攻击者没法靠计时逐位试出口令。
function safeEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  // 长度不同也要跑完整个循环，否则长度本身就会从耗时上泄漏出去。
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

function corsHeaders(env, request) {
  // 默认收紧到配置的来源。填 "*" 才允许任意站点，方便本地 file:// 调试，
  // 但公开部署时不该这么配。
  const allowed = (env.ALLOWED_ORIGIN || "").trim();
  const origin = request.headers.get("Origin") || "";
  const value = allowed === "*" ? "*" : (allowed && origin === allowed ? origin : allowed);
  return {
    "Access-Control-Allow-Origin": value || "null",
    "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function authorized(request, env) {
  if (!env.PASSCODE) return false; // 没配口令就一律拒绝，好过默认放通
  const header = request.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token.length > 0 && safeEqual(token, env.PASSCODE);
}

// 档案名会直接拼进 KV 的键里，所以限制得严一点：中英文数字和 -_ 空格。
function normalizeProfile(raw) {
  const name = (raw || "").trim();
  if (!name || name.length > MAX_PROFILE_LEN) return null;
  if (!/^[\w一-龥\- ]+$/u.test(name)) return null;
  return name;
}

// 只接受 { 色号: 正整数 }，并且限制条目数 —— 这个接口是公开可达的，不能
// 让一个畸形请求把 KV 的 1GB 额度或单值大小吃掉。
function sanitizeInventory(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_CODES) return null;
  const out = {};
  for (const [code, value] of entries) {
    if (typeof code !== "string" || !/^[A-Za-z]{1,3}\d{1,3}$/.test(code)) return null;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > MAX_COUNT) return null;
    if (n > 0) out[code] = n;
  }
  return out;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404, cors);
    }
    if (!authorized(request, env)) {
      return json({ error: "口令不对" }, 401, cors);
    }
    if (!env.INVENTORY) {
      return json({ error: "KV 未绑定，请检查 wrangler.toml 的 kv_namespaces" }, 500, cors);
    }

    try {
      if (url.pathname === "/api/profiles" && request.method === "GET") {
        const list = await env.INVENTORY.list({ prefix: "inventory:" });
        return json({ profiles: list.keys.map((k) => k.name.slice("inventory:".length)) }, 200, cors);
      }

      if (url.pathname === "/api/inventory") {
        const profile = normalizeProfile(url.searchParams.get("profile"));
        if (!profile) return json({ error: "档案名不合法" }, 400, cors);
        const key = "inventory:" + profile;

        if (request.method === "GET") {
          const raw = await env.INVENTORY.get(key, { type: "json" });
          return json(raw || { inventory: {}, updatedAt: 0 }, 200, cors);
        }

        if (request.method === "PUT") {
          let body;
          try { body = await request.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400, cors); }
          const inventory = sanitizeInventory(body && body.inventory);
          if (!inventory) return json({ error: "库存数据不合法" }, 400, cors);
          const record = { inventory, updatedAt: Date.now() };
          await env.INVENTORY.put(key, JSON.stringify(record));
          return json(record, 200, cors);
        }

        if (request.method === "DELETE") {
          await env.INVENTORY.delete(key);
          return json({ ok: true }, 200, cors);
        }
      }

      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500, cors);
    }
  },
};

// 供测试引用；Workers 运行时只用上面的 default export。
export { safeEqual, normalizeProfile, sanitizeInventory, authorized };
