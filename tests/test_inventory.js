// 豆子库存：登记、缺口计算、扣减与撤销
const { ctx, vm } = require("./harness.js");
const assert = require("assert");
const run = (c) => vm.runInContext(c, ctx);
const P = run("MARD_PALETTE");
const byCode = Object.fromEntries(P.map((e) => [e.code, e]));
vm.runInContext("globalThis.__set=(n,v)=>{eval(n+' = v')}; globalThis.__get=(n)=>eval(n);", ctx);
const set = run("__set"), get = run("__get");
const setStock = run("setStock"), stockOf = run("stockOf");

// 无 localStorage（隐私模式）时也不能崩
assert.strictEqual(run("storage")(), null, "harness 里没有 localStorage");
setStock("A1", 100);
assert.strictEqual(stockOf("A1"), 100);
console.log("PASS 没有 localStorage 时仍能在内存中记账，不抛错");

// 数量归一化：负数/小数/非法值都变成合法整数
setStock("A9", -5);  assert.strictEqual(stockOf("A9"), 0, "负数应归零");
setStock("A9", 7.8); assert.strictEqual(stockOf("A9"), 7, "小数应向下取整");
setStock("A9", "abc"); assert.strictEqual(stockOf("A9"), 0, "非法值应归零");
console.log("PASS 库存数量归一化：负数→0，小数向下取整，非法值→0");

// 缺口计算
const A = byCode.A1, B = byCode.B12, C = byCode.C4;
const cells = [
  [A, A, B],
  [A, C, B],
  [C, C, B],
];
set("boardSize", 52);
set("lastPattern", { gridW: 3, gridH: 3, cells });
set("inventory", { A1: 2, B12: 10, C4: 0 });
const { sorted, total } = run("countBeads")(cells);
assert.strictEqual(total, 9);
const rep = run("shortageReport")(sorted);
const byC = Object.fromEntries(rep.lines.map((l) => [l.code, l]));
assert.strictEqual(byC.A1.need, 3); assert.strictEqual(byC.A1.have, 2); assert.strictEqual(byC.A1.short, 1);
assert.strictEqual(byC.B12.short, 0, "B12 有 10 颗、只需 3 颗，不应缺");
assert.strictEqual(byC.C4.short, 3, "C4 完全没有，应缺 3");
assert.strictEqual(rep.shortColors, 2);
assert.strictEqual(rep.shortBeads, 4);
console.log(`PASS 缺口计算：2 种颜色共差 4 颗（A1 差 1、C4 差 3）`);

// 扣减：确认对话框返回 true
set("window", { addEventListener() {}, confirm: () => true, alert: () => {} });
run("deductCurrentPattern")();
assert.strictEqual(stockOf("A1"), 0, "A1 有 2 颗、需 3 颗，扣到 0 而不是负数");
assert.strictEqual(stockOf("B12"), 7, "B12 10-3=7");
assert.strictEqual(stockOf("C4"), 0);
assert.strictEqual(get("inventoryLog").length, 1);
console.log("PASS 扣减：B12 10→7，库存不足的扣到 0 不为负");

// 撤销只还回「实际扣掉的数量」，不能凭空造豆子
run("undoLastDeduction")();
assert.strictEqual(stockOf("A1"), 2, "A1 应还原成 2，而不是 3");
assert.strictEqual(stockOf("B12"), 10);
assert.strictEqual(stockOf("C4"), 0, "本来就没有的颜色，撤销后仍是 0");
assert.strictEqual(get("inventoryLog").length, 0);
console.log("PASS 撤销：精确还原（A1 回到 2 而非 3，C4 仍为 0）");

// 取消确认对话框则不应改动任何东西
set("window", { addEventListener() {}, confirm: () => false, alert: () => {} });
run("deductCurrentPattern")();
assert.strictEqual(stockOf("B12"), 10, "取消确认后库存不能变");
assert.strictEqual(get("inventoryLog").length, 0);
console.log("PASS 取消确认对话框时不扣减");

// 「按当前图纸补齐」只补不足的，不动已经够的
set("inventory", { A1: 1, B12: 99 });
set("window", { addEventListener() {}, confirm: () => true, alert: () => {} });
for (const [code, { count }] of sorted) if (stockOf(code) < count) setStock(code, count);
assert.strictEqual(stockOf("A1"), 3, "不足的补到刚好够");
assert.strictEqual(stockOf("B12"), 99, "已经够的不应被下调");
console.log("PASS 补齐：不足的补到刚好够，富余的保持不变");

// 导出/导入用的色号必须都是真实存在的
set("inventory", { A1: 5, ZZ999: 3 });
const known = new Set(P.map((e) => e.code));
const exportable = Object.keys(get("inventory")).filter((c) => known.has(c));
assert.deepStrictEqual(exportable, ["A1"], "导入时应过滤掉不存在的色号");
console.log("PASS 未知色号不会被当作有效库存");

console.log("\nALL INVENTORY TESTS PASSED");

// --- 批量填数字 ---
{
  const A = byCode.A1, B = byCode.B12;
  const g = [[A, A, B], [A, B, B]];
  set("boardSize", 52);
  set("lastPattern", { gridW: 3, gridH: 2, cells: g });
  set("inventory", { A1: 10, C4: 999 });        // C4 不在图纸里，但已登记
  set("inventoryShowAll", false);
  set("window", { addEventListener() {}, confirm: () => true, alert: () => {} });

  const rows = run("inventoryRows")().map((r) => r.code).sort();
  assert.strictEqual(JSON.stringify([...rows]), JSON.stringify(["A1","B12","C4"]), "默认范围 = 图纸用到的 + 已登记的，实际 " + rows);
  console.log("PASS 批量范围：默认只覆盖相关色号 →", rows.join(","));

  const bulkInput = run("document").getElementById("inventory-bulk-value");
  bulkInput.value = "500";
  run("applyBulk")("set");
  for (const c of rows) assert.strictEqual(stockOf(c), 500, c + " 应被设为 500");
  console.log("PASS 全部设为 500：列出的 3 个色号统一改成同一个数");

  bulkInput.value = "20";
  run("applyBulk")("add");
  for (const c of rows) assert.strictEqual(stockOf(c), 520, c + " 应在原值上 +20");
  console.log("PASS 全部各加 20：在原有数量上累加（500 → 520），不是覆盖");

  // 「各加」必须尊重各自的原值，而不是把大家拉平
  set("inventory", { A1: 10, B12: 3, C4: 5 });
  bulkInput.value = "7";
  run("applyBulk")("add");
  assert.strictEqual(stockOf("A1"), 17);
  assert.strictEqual(stockOf("B12"), 10);
  assert.strictEqual(stockOf("C4"), 12);
  console.log("PASS 各加保留差异：10/3/5 各加 7 → 17/10/12");

  // 取消确认对话框不应改动
  set("inventory", { A1: 42 });
  set("window", { addEventListener() {}, confirm: () => false, alert: () => {} });
  run("applyBulk")("set");
  assert.strictEqual(stockOf("A1"), 42, "取消确认后不应改动");
  console.log("PASS 批量操作带确认，取消则不动数据");
}

// --- 同步配置状态 ---
{
  set("syncConfig", { url: "", passcode: "", profile: "" });
  assert.strictEqual(run("syncReady")(), false, "缺信息时不应认为已连接");
  set("syncConfig", { url: "https://x.workers.dev", passcode: "p", profile: "" });
  assert.strictEqual(run("syncReady")(), false, "少了档案名也不算就绪");
  set("syncConfig", { url: "https://x.workers.dev", passcode: "p", profile: "小李" });
  assert.strictEqual(run("syncReady")(), true);
  console.log("PASS syncReady：三样齐全才算已连接");

  // 没连服务器时，自动上传不应被触发（否则会报一堆错）
  let called = 0;
  set("syncConfig", { url: "", passcode: "", profile: "", autoPush: true });
  set("syncPush", () => { called++; });
  run("scheduleSyncPush")();
  assert.strictEqual(called, 0, "未配置时不应尝试上传");
  console.log("PASS 未配置同步时，改库存不会去连网");
}

console.log("\nALL INVENTORY TESTS PASSED (含批量与同步状态)");
