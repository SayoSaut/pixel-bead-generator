// 用豆清单按色号/需要/库存排序，正序倒序
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) { console.log("SKIP 未安装 jsdom，跳过（npm i 后可运行）"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "dist/index.html"), "utf8").replace(/<script src="https:\/\/[^"]+"><\/script>/g, "");
const errs = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.com/",
  beforeParse(w) {
    const c = new Proxy({}, { get: (t,k) => k==="getImageData" ? ((x,y,ww,hh)=>({width:ww,height:hh,data:new Uint8ClampedArray(ww*hh*4)})) : (k==="measureText"?(()=>({width:10})):(()=>{})) });
    w.HTMLCanvasElement.prototype.getContext = () => c;
    w.HTMLCanvasElement.prototype.toDataURL = () => "";
    w.addEventListener("error", (e) => errs.push(String(e.error && e.error.stack || e.message)));
  }});
const { window } = dom, d = window.document;

// A1 x1、A9 x5、A10 x3、B12 x2
window.eval(`
  boardW = boardH = boardSize = 52; sourceImage = {};
  const P = (c) => MARD_PALETTE.find(e => e.code === c);
  const cells = [
    [P("A9"), P("A9"), P("A9"), P("A9")],
    [P("A9"), P("A10"), P("A10"), P("A10")],
    [P("B12"), P("B12"), P("A1"), null],
  ];
  lastPattern = { gridW: 4, gridH: 3, cells };
  inventory = { A1: 500, A9: 1, A10: 50, B12: 200 };
  renderUsage(lastPattern);
`);

const codes = () => [...d.querySelectorAll("#usage-table tbody tr")]
  .filter((tr) => !tr.classList.contains("usage-total"))
  .map((tr) => tr.children[0].textContent);
const nums = (i) => [...d.querySelectorAll("#usage-table tbody tr")]
  .filter((tr) => !tr.classList.contains("usage-total"))
  .map((tr) => tr.children[i].textContent);

// 默认：色号升序，数字正序（A9 在 A10 前）
assert.deepStrictEqual(codes(), ["A1", "A9", "A10", "B12"]);
console.log("PASS 默认按色号升序，A9 在 A10 前 →", codes().join(","));

const th = (k) => d.querySelector(`.th-sort[data-sort="${k}"]`);

// 点「需要」：先给从大到小（人想先看用得最多的）
th("count").click();
assert.deepStrictEqual(codes(), ["A9", "A10", "B12", "A1"], "实际 " + codes());
assert.deepStrictEqual(nums(2), ["5", "3", "2", "1"]);
console.log("PASS 点「需要」→ 倒序（用量从多到少）:", nums(2).join(" > "));

// 再点一次翻转
th("count").click();
assert.deepStrictEqual(nums(2), ["1", "2", "3", "5"]);
console.log("PASS 再点一次 → 正序（从少到多）:", nums(2).join(" < "));

// 箭头指示
assert.ok(th("count").classList.contains("is-active"));
assert.strictEqual(th("count").querySelector(".sort-arrow").textContent, "▲");
assert.strictEqual(th("code").querySelector(".sort-arrow").textContent, "", "非当前列不应显示箭头");
console.log("PASS 箭头只标在当前排序列，并随方向变化");

// 按库存排序
th("stock").click();
assert.deepStrictEqual(codes(), ["A1", "B12", "A10", "A9"], "库存降序，实际 " + codes());
console.log("PASS 点「库存」→ 按库存从多到少:", codes().join(","));
th("stock").click();
assert.deepStrictEqual(codes(), ["A9", "A10", "B12", "A1"]);
console.log("PASS 库存正序（最缺的排最前，方便先去补货）");

// 回到色号列，方向应重置为升序而不是沿用上一列的倒序
th("code").click();
assert.deepStrictEqual(codes(), ["A1", "A9", "A10", "B12"]);
assert.strictEqual(th("code").querySelector(".sort-arrow").textContent, "▲");
console.log("PASS 换回色号列时方向重置为升序");

// 合计行始终在最后
const last = [...d.querySelectorAll("#usage-table tbody tr")].pop();
assert.ok(last.classList.contains("usage-total"), "合计行必须固定在末尾");
assert.strictEqual(last.children[2].textContent, "11", "合计需要 11 颗");
console.log("PASS 合计行不参与排序，固定在末尾（共 11 颗）");

// 图纸下方的清单不受表格排序影响，始终按色号
window.eval("usageSort = { key: 'count', dir: -1 };");
const legend = window.eval("countBeads(lastPattern.cells).sorted.map(s => s[0]).join(',')");
assert.strictEqual(legend, "A1,A9,A10,B12", "图纸清单/CSV 应始终按色号排序，实际 " + legend);
console.log("PASS 图纸下方清单与 CSV 不受界面排序影响，始终按色号");

if (errs.length) { console.error("!! 运行期错误:\n" + errs.join("\n")); process.exit(1); }
console.log("\nALL SORT TESTS PASSED");
