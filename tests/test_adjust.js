// 真实 DOM：选中颜色后用输入框加减
// 需要 jsdom：npm i（没装则跳过）
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

window.eval(`
  boardSize = 52; sourceImage = {};
  const A = MARD_PALETTE.find(e => e.code === "A1");
  const B = MARD_PALETTE.find(e => e.code === "B12");
  lastPattern = { gridW: 2, gridH: 2, cells: [[A, A], [B, A]] };
  inventory = { A1: 100 };
  renderPattern(lastPattern); renderUsage(lastPattern);
  document.getElementById("inventory-panel").hidden = false;
  renderInventoryEditor();
`);

// 未选中时给引导
assert.ok(d.getElementById("inventory-adjust").textContent.includes("点下面列表里的任意一行"));
console.log("PASS 未选中时给出引导");

// 库存面板的选中，必须与画板高亮互不影响
window.eval("highlightIndex = null;");
const row0 = [...d.querySelectorAll(".inv-row")].find((r) => r.textContent.includes("A1"));
row0.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
assert.strictEqual(window.eval("invSelected"), "A1", "点库存行应选中该行");
assert.strictEqual(window.eval("highlightIndex"), null, "不应顺带改变画板高亮");
assert.ok(d.querySelector(".inv-row.is-selected"), "选中的行要有视觉标记");
console.log("PASS 库存行选中与画板高亮解耦：选行不会改动图纸显示");

const adjustBox = d.getElementById("inventory-adjust");
assert.ok(adjustBox.textContent.includes("A1"), "应显示选中的色号");
assert.ok(adjustBox.textContent.includes("现有 100 颗"), "应显示当前数量：" + adjustBox.textContent);
console.log("PASS 显示选中色号与现有数量");

// 用掉 30
d.getElementById("inventory-adjust-value").value = "30";
d.getElementById("inventory-adjust-minus").click();
assert.strictEqual(window.eval('stockOf("A1")'), 70, "100 - 30 应为 70");
assert.ok(d.getElementById("inventory-adjust-note").textContent.includes("100 → 70"));
console.log("PASS 减：100 − 30 = 70，并回显变化");

// 补货 250
d.getElementById("inventory-adjust-value").value = "250";
d.getElementById("inventory-adjust-plus").click();
assert.strictEqual(window.eval('stockOf("A1")'), 320);
console.log("PASS 加：70 + 250 = 320");

// 减到负数应停在 0，并说明
d.getElementById("inventory-adjust-value").value = "9999";
d.getElementById("inventory-adjust-minus").click();
assert.strictEqual(window.eval('stockOf("A1")'), 0, "不应变成负数");
assert.ok(d.getElementById("inventory-adjust-note").textContent.includes("停在 0"), "应说明被截断");
console.log("PASS 减过头停在 0，并明确告知而不是静默截断");

// 负数输入按绝对值处理：−按钮就是减，不该因为输了负号变成加
window.eval('inventory = { A1: 50 }; invSelected = "A1"; renderInventoryEditor();');
d.getElementById("inventory-adjust-value").value = "-10";
d.getElementById("inventory-adjust-minus").click();
assert.strictEqual(window.eval('stockOf("A1")'), 40, "输入 -10 点「用掉」仍应是减 10");
console.log("PASS 输入带负号也按绝对值处理，方向只由按钮决定");

// 回车 = 补货
window.eval('inventory = { A1: 5 }; invSelected = "A1"; renderInventoryEditor();');
const inp = d.getElementById("inventory-adjust-value");
inp.value = "12";
inp.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
assert.strictEqual(window.eval('stockOf("A1")'), 17, "回车应按补货处理");
console.log("PASS 回车 = 补货（拆包倒豆是最常发生的操作）");

// 每行自带的 −/+ ：不必先选中，直接作用于那一行
window.eval('inventory = { A1: 100, B12: 8 }; invSelected = null; renderInventoryEditor();');
d.getElementById("inventory-adjust-value").value = "5";
const b12Row = [...d.querySelectorAll(".inv-row")].find((r) => r.textContent.includes("B12"));
b12Row.querySelector('.inv-step[data-step="1"]').click();
assert.strictEqual(window.eval('stockOf("B12")'), 13, "行内 + 应对该行生效：8 + 5 = 13");
assert.strictEqual(window.eval('stockOf("A1")'), 100, "不该动到别的行");
console.log("PASS 行内 + ：直接作用于那一行，不影响其它行");

const b12Row2 = [...d.querySelectorAll(".inv-row")].find((r) => r.textContent.includes("B12"));
b12Row2.querySelector('.inv-step[data-step="-1"]').click();
assert.strictEqual(window.eval('stockOf("B12")'), 8, "行内 − ：13 − 5 = 8");
console.log("PASS 行内 − ：同上");

// 点 −/+ 不应把该行"折叠"掉选中态判断（按钮点击不触发选行）
assert.strictEqual(window.eval("invSelected"), "B12", "行内按钮操作后应把该行设为当前选中");
console.log("PASS 行内按钮操作后，上方面板跟着切到这一行");

// 再点一次同一行取消选中
[...d.querySelectorAll(".inv-row")].find((r) => r.textContent.includes("B12"))
  .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
assert.strictEqual(window.eval("invSelected"), null);
console.log("PASS 再点一次取消选中");

if (errs.length) { console.error("!! 运行期错误:\n" + errs.join("\n")); process.exit(1); }
console.log("\nALL ADJUST TESTS PASSED");
