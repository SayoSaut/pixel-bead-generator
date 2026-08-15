/**
 * 拼豆库存同步 Worker
 *
 * 一个极小的键值 API，让几个人的库存能跨设备同步。前端仍然托管在 GitHub
 * Pages 上，只有库存读写走这里。
 *
 * 认证：一人一个口令，口令本身就是身份。USERS 这个 secret 是一份
 * {"口令":"名字"} 的 JSON，服务端据此决定这次请求属于谁，客户端根本不
 * 提交自己是谁 —— 所以拿着自己口令的人无法读写别人的数据，隔离是服务端
 * 强制的，不是靠客户端自觉填对名字。
 *
 * 早先的版本是"全员共用一个口令 + 客户端提交档案名"，那样只是把数据分开
 * 放，并没有隔离：填别人的名字就能读别人的，名字打错一个字还会静默写到
 * 别人头上。
 *
 * 这仍然不是账号系统 —— 没有注册、找回、改密。加人和踢人靠管理员改 USERS
 * 这个 secret。对"就几个熟人"的规模，这个取舍是划算的。
 *
 * 路由（都不带 profile 参数，身份完全由口令决定）：
 *   GET    /api/me          我是谁
 *   GET    /api/inventory   读我自己的库存
 *   PUT    /api/inventory   写我自己的库存
 *   DELETE /api/inventory   删我自己的库存
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

// 口令的字符集限制得死一点：它会被直接当成 KV 的键用（见下），而且限制
// 字符集也顺带挡掉了各种奇怪的注入尝试。
const PASSCODE_RE = /^[A-Za-z0-9_-]{6,64}$/;

// 把口令解析成"这是谁"。找不到就是 null，调用方一律当作未授权。
//
// 两种配置名单的方式，够用就行，不必两个都配：
//
// 1. KV 里一人一条：键 `user:<口令>`，值就是名字。推荐 —— 在 Cloudflare
//    控制台的 KV Pairs 标签页里点几下就能加人/改名/踢人，不用碰 secret，
//    也不用手写 JSON。查的是精确键，是一次哈希查找，不存在"口令排在名单
//    第几位"的计时差异。
//
// 2. USERS secret：一份 {"口令":"名字"} 的 JSON。好处是加密存储，管理员
//    在控制台也看不到明文；代价是加个人要重写整份 JSON。
//
// 两个都配时以 secret 为准 —— 它更像"权威名单"，且能覆盖掉 KV 里可能被
// 误改的内容。
async function resolveUser(env, token) {
  if (!PASSCODE_RE.test(token || "")) return null;

  if (env.USERS) {
    let users;
    try { users = JSON.parse(env.USERS); } catch (e) { return null; }
    // 循环不提前退出：一命中就 break 的话，耗时会随口令在名单里的位置变化，
    // 那是可以被计时观测出来的。全部比完再返回。
    let found = null;
    for (const [passcode, name] of Object.entries(users)) {
      if (safeEqual(token, passcode)) found = name;
    }
    if (typeof found === "string" && found) return found;
  }

  if (env.INVENTORY) {
    const name = await env.INVENTORY.get("user:" + token);
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

function bearerToken(request) {
  return (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
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

    // 名单可能存在 KV 里，所以鉴权要先确认 KV 绑好了，否则会把"忘了绑 KV"
    // 误报成"口令不对"，排查方向就完全带偏了。
    if (!env.INVENTORY && !env.USERS) {
      return json({ error: "服务端没配置：请在 Worker 的 Bindings 里加一个变量名为 INVENTORY 的 KV namespace" }, 500, cors);
    }

    const profile = await resolveUser(env, bearerToken(request));
    if (!profile) return json({ error: "口令不对，或这个口令还没被加进名单" }, 401, cors);
    // 名字来自服务端的 USERS，仍然过一遍规范化 —— 管理员在 secret 里手滑
    // 写了个带斜杠的名字，不该变成能污染其它键的 KV key。
    const safeName = normalizeProfile(profile);
    if (!safeName) return json({ error: "服务端 USERS 里这个名字不合法" }, 500, cors);

    if (!env.INVENTORY) {
      return json({ error: "KV 未绑定：请在 Worker 的 Bindings 里加一个变量名为 INVENTORY 的 KV namespace" }, 500, cors);
    }

    const key = "inventory:" + safeName;

    try {
      if (url.pathname === "/api/me" && request.method === "GET") {
        return json({ profile: safeName }, 200, cors);
      }

      if (url.pathname === "/api/inventory") {
        if (request.method === "GET") {
          const raw = await env.INVENTORY.get(key, { type: "json" });
          return json({ ...(raw || { inventory: {}, updatedAt: 0 }), profile: safeName }, 200, cors);
        }

        if (request.method === "PUT") {
          let body;
          try { body = await request.json(); } catch (e) { return json({ error: "请求体不是合法 JSON" }, 400, cors); }
          const inventory = sanitizeInventory(body && body.inventory);
          if (!inventory) return json({ error: "库存数据不合法" }, 400, cors);
          const record = { inventory, updatedAt: Date.now() };
          await env.INVENTORY.put(key, JSON.stringify(record));
          return json({ ...record, profile: safeName }, 200, cors);
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
export { safeEqual, normalizeProfile, sanitizeInventory, resolveUser };
