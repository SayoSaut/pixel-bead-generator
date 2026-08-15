// Worker：认证、校验、读写、CORS
import worker, { safeEqual, normalizeProfile, sanitizeInventory } from "../worker/src/index.js";
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
const env = () => ({ INVENTORY: fakeKV(), PASSCODE: "hunter2", ALLOWED_ORIGIN: ORIGIN });
const req = (path, { method = "GET", token = "hunter2", body, origin = ORIGIN } = {}) =>
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
let r = await worker.fetch(req("/api/profiles", { token: "" }), e);
assert.strictEqual(r.status, 401);
r = await worker.fetch(req("/api/profiles", { token: "wrong" }), e);
assert.strictEqual(r.status, 401);
console.log("PASS 认证：无口令 / 错口令都返回 401");

r = await worker.fetch(req("/api/profiles"), { ...e, PASSCODE: "" });
assert.strictEqual(r.status, 401, "没配 PASSCODE 时必须拒绝，不能默认放通");
console.log("PASS 认证：未配置口令时默认拒绝而非放通");

// --- 读写 ---
e = env();
r = await worker.fetch(req("/api/inventory?profile=小李"), e);
assert.strictEqual(r.status, 200);
assert.deepStrictEqual(await r.json(), { inventory: {}, updatedAt: 0 }, "没存过应返回空档案");

r = await worker.fetch(req("/api/inventory?profile=小李", { method: "PUT", body: { inventory: { A1: 12, C4: 3 } } }), e);
assert.strictEqual(r.status, 200);
const saved = await r.json();
assert.deepStrictEqual(saved.inventory, { A1: 12, C4: 3 });
assert.ok(saved.updatedAt > 0, "应写入时间戳");

r = await worker.fetch(req("/api/inventory?profile=小李"), e);
assert.deepStrictEqual((await r.json()).inventory, { A1: 12, C4: 3 });
console.log("PASS 读写：写入后能读回，且带 updatedAt");

// 档案互不干扰
await worker.fetch(req("/api/inventory?profile=小张", { method: "PUT", body: { inventory: { B2: 9 } } }), e);
r = await worker.fetch(req("/api/inventory?profile=小李"), e);
assert.deepStrictEqual((await r.json()).inventory, { A1: 12, C4: 3 }, "写小张不能影响小李");
r = await worker.fetch(req("/api/profiles"), e);
assert.deepStrictEqual((await r.json()).profiles.sort(), ["小张", "小李"].sort());
console.log("PASS 多档案：各存各的，profiles 能列出全部");

// 畸形请求
r = await worker.fetch(req("/api/inventory?profile=小李", { method: "PUT", body: { inventory: { A1: -3 } } }), e);
assert.strictEqual(r.status, 400);
r = await worker.fetch(req("/api/inventory?profile=", { method: "GET" }), e);
assert.strictEqual(r.status, 400);
r = await worker.fetch(req("/api/inventory?profile=小李"), e);
assert.deepStrictEqual((await r.json()).inventory, { A1: 12, C4: 3 }, "非法写入不能污染已有数据");
console.log("PASS 畸形请求返回 400，且不破坏已存数据");

// 删除
r = await worker.fetch(req("/api/inventory?profile=小张", { method: "DELETE" }), e);
assert.strictEqual(r.status, 200);
r = await worker.fetch(req("/api/profiles"), e);
assert.deepStrictEqual((await r.json()).profiles, ["小李"]);
console.log("PASS 删除档案");

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
