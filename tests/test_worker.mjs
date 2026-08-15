// Worker：认证、校验、读写、CORS
import worker, { safeEqual, normalizeProfile, sanitizeInventory, resolveUser } from "../worker/src/index.js";
import assert from "assert";

// 内存版 KV，够跑完整条请求路径
function fakeKV() {
  const m = new Map();
  return {
    _m: m,
    async get(k, o) { const v = m.get(k); return v === undefined ? null : (o && o.type === "json" ? JSON.parse(v) : v); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const ORIGIN = "https://sayosaut.github.io";
// 小李用 KV 名单，小张用 USERS secret —— 两条路都要覆盖
function env() {
  const kv = fakeKV();
  kv._m.set("user:lee-secret-001", "小李");
  return { INVENTORY: kv, USERS: JSON.stringify({ "zhang-secret-002": "小张" }), ALLOWED_ORIGIN: ORIGIN };
}
const req = (path, { method = "GET", token = "lee-secret-001", body, origin = ORIGIN } = {}) =>
  new Request("https://w.example.com" + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      Origin: origin,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

// --- 纯函数 ---
assert.ok(safeEqual("abc", "abc"));
assert.ok(!safeEqual("abc", "abd"));
assert.ok(!safeEqual("abc", "abcd"), "长度不同必须判不等");
console.log("PASS safeEqual：等值/不等值/长度不同");

assert.strictEqual(normalizeProfile("  小李 "), "小李");
assert.strictEqual(normalizeProfile("Ann_1"), "Ann_1");
assert.strictEqual(normalizeProfile(""), null);
assert.strictEqual(normalizeProfile("a".repeat(25)), null, "超长应拒绝");
assert.strictEqual(normalizeProfile("../../etc"), null, "路径穿越字符应拒绝");
assert.strictEqual(normalizeProfile("a\nb"), null);
console.log("PASS normalizeProfile：中英文可用，超长/路径穿越/换行被拒");

assert.deepStrictEqual(sanitizeInventory({ A1: 5, B12: 0 }), { A1: 5 }, "0 应被丢弃");
assert.deepStrictEqual(sanitizeInventory({ A1: "7" }), { A1: 7 }, "数字字符串应接受");
assert.strictEqual(sanitizeInventory({ A1: -1 }), null, "负数应拒绝");
assert.strictEqual(sanitizeInventory({ "不是色号": 1 }), null);
assert.strictEqual(sanitizeInventory({ A1: 1e9 }), null, "超大数应拒绝");
assert.strictEqual(sanitizeInventory([1, 2]), null, "数组应拒绝");
assert.strictEqual(sanitizeInventory(null), null);
assert.strictEqual(sanitizeInventory(Object.fromEntries(Array.from({length: 500}, (_, i) => ["A" + i, 1]))), null, "条目过多应拒绝");
console.log("PASS sanitizeInventory：只收合法色号与正整数，拒绝畸形/超量数据");

// --- 认证 ---
let e = env();
let r = await worker.fetch(req("/api/me", { token: "" }), e);
assert.strictEqual(r.status, 401);
r = await worker.fetch(req("/api/me", { token: "not-a-real-code" }), e);
assert.strictEqual(r.status, 401);
console.log("PASS 认证：无口令 / 未登记的口令都返回 401");

r = await worker.fetch(req("/api/me", { token: "short" }), e);
assert.strictEqual(r.status, 401, "过短的口令应直接拒绝");
console.log("PASS 认证：口令格式不合规直接拒绝（不去查 KV）");

r = await worker.fetch(req("/api/me"), { INVENTORY: null, USERS: "" });
assert.strictEqual(r.status, 500, "没配名单来源时应报配置错误，而不是含糊的 401");
console.log("PASS 认证：服务端没配置时报 500 而非误导成「口令不对」");

// --- 身份来自服务端，客户端说了不算 ---
e = env();
r = await worker.fetch(req("/api/me"), e);
assert.deepStrictEqual(await r.json(), { profile: "小李" });
r = await worker.fetch(req("/api/me", { token: "zhang-secret-002" }), e);
assert.deepStrictEqual(await r.json(), { profile: "小张" });
console.log("PASS 身份解析：KV 名单 → 小李，USERS secret → 小张，两条路都通");

// --- 隔离：拿自己的口令读不到别人的数据 ---
await worker.fetch(req("/api/inventory", { method: "PUT", body: { inventory: { A1: 12 } } }), e);            // 小李
await worker.fetch(req("/api/inventory", { method: "PUT", token: "zhang-secret-002", body: { inventory: { B2: 99 } } }), e); // 小张

r = await worker.fetch(req("/api/inventory"), e);
let lee = await r.json();
assert.deepStrictEqual(lee.inventory, { A1: 12 });
assert.strictEqual(lee.profile, "小李");

r = await worker.fetch(req("/api/inventory", { token: "zhang-secret-002" }), e);
let zhang = await r.json();
assert.deepStrictEqual(zhang.inventory, { B2: 99 });
console.log("PASS 隔离：两人各读各的，互不串档");

// 关键：URL 上硬塞别人的 profile 也没用，身份只认口令
r = await worker.fetch(req("/api/inventory?profile=" + encodeURIComponent("小张")), e);
assert.deepStrictEqual((await r.json()).inventory, { A1: 12 }, "小李带上小张的名字仍应只读到自己的");
r = await worker.fetch(req("/api/inventory?profile=" + encodeURIComponent("小张"), { method: "PUT", body: { inventory: { A9: 1 } } }), e);
assert.strictEqual(r.status, 200);
r = await worker.fetch(req("/api/inventory", { token: "zhang-secret-002" }), e);
assert.deepStrictEqual((await r.json()).inventory, { B2: 99 }, "小李无论如何都不该写进小张的数据");
console.log("PASS 隔离：URL 里伪造 profile 无效，服务端只认口令");

// --- 畸形请求 ---
r = await worker.fetch(req("/api/inventory", { method: "PUT", body: { inventory: { A1: -3 } } }), e);
assert.strictEqual(r.status, 400);
r = await worker.fetch(req("/api/inventory"), e);
assert.deepStrictEqual((await r.json()).inventory, { A9: 1 }, "非法写入不能污染已有数据");
console.log("PASS 畸形请求 400，且不破坏已存数据");

// --- 删除只删自己的 ---
r = await worker.fetch(req("/api/inventory", { method: "DELETE" }), e);
assert.strictEqual(r.status, 200);
r = await worker.fetch(req("/api/inventory", { token: "zhang-secret-002" }), e);
assert.deepStrictEqual((await r.json()).inventory, { B2: 99 }, "小李删自己不应影响小张");
console.log("PASS 删除只作用于自己的档案");

// --- CORS ---
r = await worker.fetch(req("/api/profiles", { method: "OPTIONS" }), e);
assert.strictEqual(r.status, 204);
assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
r = await worker.fetch(req("/api/profiles", { origin: "https://evil.example" }), e);
assert.strictEqual(r.headers.get("Access-Control-Allow-Origin"), ORIGIN,
  "别的来源不应拿到自己的 origin 回显");
console.log("PASS CORS：预检 204，只回显配置的来源");

r = await worker.fetch(req("/nope"), e);
assert.strictEqual(r.status, 404);
console.log("PASS 未知路径 404");

console.log("\nALL WORKER TESTS PASSED");
