// 端到端：用真实 DOM 加载 dist/index.html，脚本真的跑、事件真的派发。
//
// 这一组是必要的补充 —— harness.js 的 stub 里 addEventListener 是空函数，
// 所以它能验证「缩放函数算得对」，却验证不了「按钮有没有接上」。之前编辑器
// 入口被单击高亮抢走、只能靠拖拽进入，就是 stub 测试看不见的那类问题。
//
// 需要 jsdom：npm i -D jsdom（没装则自动跳过）
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) {
  console.log("SKIP 未安装 jsdom，跳过真实 DOM 集成测试（npm i -D jsdom 后可运行）");
  process.exit(0);
}
const fs = require("fs"); const assert = require("assert");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8").replace(/<script src="https:\/\/[^"]+"><\/script>/g, "");
const errs = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.com/",
  beforeParse(w) {
    const c = new Proxy({}, { get: (t,k) => k==="getImageData" ? ((x,y,ww,hh)=>({width:ww,height:hh,data:new Uint8ClampedArray(ww*hh*4)})) : (k==="measureText"?(()=>({width:10})):(()=>{})) });
    w.HTMLCanvasElement.prototype.getContext = () => c;
    w.HTMLCanvasElement.prototype.toDataURL = () => "";
    w.addEventListener("error", (e) => errs.push(String(e.error && e.error.stack || e.message)));
  }});
const { window } = dom; const d = window.document;
const main = d.getElementById("pattern-canvas");
const editor = d.getElementById("cell-editor");
window.eval(`
  boardW = boardH = boardSize = 52; sourceImage = {};
  const _c = Array.from({length:6}, () => Array.from({length:6}, () => MARD_PALETTE[0]));
  lastPattern = { gridW: 6, gridH: 6, cells: _c };
  renderPattern(lastPattern);
  document.getElementById("open-editor").disabled = false;
`);
main.getBoundingClientRect = () => ({ left: 0, top: 0, width: main.width, height: main.height });
const CELL = window.eval("CELL_PX"), GUT = window.eval("GUTTER_PX");
const off = Math.floor((52 - 6) / 2);
const px = GUT + off * CELL + 5, py = GUT + off * CELL + 5;
const mev = (t, o={}) => new window.MouseEvent(t, { clientX: px, clientY: py, bubbles: true, cancelable: true, ...o });

// 1) 单击仍然是高亮，不开编辑器
main.dispatchEvent(mev("mousedown")); window.dispatchEvent(mev("mouseup"));
assert.strictEqual(editor.hidden, true);
assert.strictEqual(window.eval("highlightIndex"), 0);
console.log("PASS 单击 → 高亮颜色（不打开编辑器）");

// 2) 双击进编辑器
main.dispatchEvent(mev("dblclick"));
assert.strictEqual(editor.hidden, false, "双击应打开编辑器");
assert.strictEqual(window.eval("editorSelection.size"), 1, "双击应选中那一格");
assert.strictEqual(window.eval("highlightIndex"), null, "进编辑器时应清掉高亮");
console.log("PASS 双击 → 打开编辑器并选中该格，同时清掉高亮");

// 3) 工具栏按钮也能进
d.getElementById("editor-exit").click();
assert.strictEqual(editor.hidden, true);
d.getElementById("open-editor").click();
assert.strictEqual(editor.hidden, false, "「编辑格子」按钮应能打开编辑器");
console.log("PASS 「编辑格子」按钮 → 打开编辑器");

// 4) 编辑器里的缩放依然可用
const wrap = d.getElementById("editor-pattern-wrap"), canvas = d.getElementById("editor-pattern-canvas");
Object.defineProperty(wrap, "clientWidth", { value: 800, configurable: true });
Object.defineProperty(wrap, "clientHeight", { value: 600, configurable: true });
window.eval("renderEditorPatternCanvas()");
const before = parseFloat(canvas.style.width);
d.getElementById("editor-zoom-in").click();
const after = parseFloat(canvas.style.width);
assert.ok(after > before, `缩放应生效 ${before} → ${after}`);
console.log(`PASS 编辑器缩放可用：${before}px → ${after}px（${d.getElementById("editor-zoom-label").textContent}）`);

if (errs.length) { console.error("!! 运行期错误:\n" + errs.join("\n")); process.exit(1); }
console.log("\nALL EDITOR-ACCESS TESTS PASSED");
