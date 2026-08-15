const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = process.argv[2] || "/sessions/stoic-magical-cannon/mnt/pixel-bead-generator";
const calls = [];

function makeCtx(canvas) {
  const rec = (name) => (...args) => calls.push({ canvas: canvas._id, name, args });
  return {
    canvas,
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "",
    fillRect: rec("fillRect"), strokeRect: rec("strokeRect"), clearRect: rec("clearRect"),
    beginPath: rec("beginPath"), moveTo: rec("moveTo"), lineTo: rec("lineTo"),
    stroke: rec("stroke"), fill: rec("fill"), arc: rec("arc"), drawImage: rec("drawImage"),
    fillText: rec("fillText"), save: rec("save"), restore: rec("restore"),
    closePath: rec("closePath"), translate: rec("translate"), rotate: rec("rotate"), scale: rec("scale"),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
}

let idSeq = 0;
function makeCanvas(id) {
  const c = {
    _id: id || ("canvas" + idSeq++), width: 300, height: 150, style: {},
    getContext() { return c._ctx || (c._ctx = makeCtx(c)); },
    addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }),
    toDataURL: () => "data:image/png;base64,",
    parentElement: { clientWidth: 800 },
  };
  return c;
}

const els = {};
const el = (id) => (els[id] = els[id] || {
  id, style: {}, dataset: {}, classList: { toggle() {}, add() {}, contains: () => false },
  children: [], value: "1", checked: false, textContent: "", innerHTML: "", hidden: false,
  clientWidth: 800, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
  addEventListener() {}, appendChild() {}, querySelector: () => null,
  querySelectorAll: () => [], closest: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
});

const canvases = {};
const document = {
  getElementById(id) {
    if (id.indexOf("canvas") >= 0) return canvases[id] || (canvases[id] = makeCanvas(id));
    return el(id);
  },
  querySelector: (sel) => (sel.indexOf("canvas") >= 0 ? makeCanvas(sel) : el(sel)),
  querySelectorAll: () => [],
  createElement: (tag) => (tag === "canvas" ? makeCanvas() : el(tag)),
};
const win = { addEventListener() {} };

const sandbox = { document, window: win, console, Image: function () {}, FileReader: function () {},
  URL: { createObjectURL: () => "" }, Blob: function () {} };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, "palette.js"), "utf8"), ctx, { filename: "palette.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), ctx, { filename: "app.js" });

module.exports = { ctx, vm, calls, canvases, makeCanvas, els };
