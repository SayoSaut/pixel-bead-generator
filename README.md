# 拼豆图纸生成器

上传图片，自动生成 Mard 221 色拼豆图纸，并在图纸下方直接列出每个色号需要多少颗豆子。

纯前端静态页面，没有后端、没有构建依赖，所有计算都在浏览器里完成——图片不会上传到任何服务器。

## 功能

- 自动智能裁剪：按「颜色对比 × 边缘密度」找主体，也可手动拖动边框调整
- 板子规格 52×52 / 78×78 / 104×104（对应 2/3/4 块 26×26 拼豆板）
- 三种抠图方式：颜色泛洪（本地）、ML 人像、通用物体分割（后两者需联网下载模型）
- 格子编辑器：框选局部格子，用吸管或候选色手动修正
- **用豆清单**：按色号排序（字母升序 + 数字正序，A9 排在 A10 前面），画在图纸正下方，导出的 PNG 自带清单，可直接打印
- 导出图纸 PNG / 用量清单 CSV

## 本地预览

直接双击 `index.html` 就能用。或者起个本地服务器：

```bash
python3 -m http.server 8934
# 打开 http://localhost:8934
```

## 打包成单文件

```bash
python3 build.py     # 生成 dist/index.html
```

把 CSS、调色板和逻辑全部内联成一个 HTML 文件，方便发给别人或丢到任意主机上。
（可选的 ML 抠图模型仍从 CDN 按需加载，那部分本来就需要联网。）

## 发布到网上

站点是纯静态的，任选一种：

**GitHub Pages**（推荐，免费且带自己的域名）

在仓库页面 → Settings → Pages → Source 选 `Deploy from a branch`，
分支选 `main` / 目录选 `/ (root)`，保存。约一分钟后站点上线于
<https://sayosaut.github.io/pixel-bead-generator/>。

**Netlify / Vercel / Cloudflare Pages**

拖拽整个文件夹到 [app.netlify.com/drop](https://app.netlify.com/drop) 即可，无需配置——
没有构建步骤，Build command 留空，Publish directory 填 `.`。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式 |
| `palette.js` | Mard 221 色标准色卡（HEX 为屏幕近似值） |
| `app.js` | 全部逻辑：裁剪、抠图、量化、渲染、清单、导出 |
| `build.py` | 打包成 `dist/index.html` 单文件 |
| `serve.py` | 本地开发用的小服务器 |

## 注意

色卡 HEX 来自 [pixel-beads.com](https://www.pixel-beads.com/zh/mard-bead-color-chart) 的屏幕显示值，
实体豆子颜色会受光线和批次影响，如有偏差请手动校准 `palette.js`。

本地 `testpic/` 目录（如果有）已被 `.gitignore` 排除，因为里面是第三方美术素材，
只用于本地试功能。

## 许可

[MIT](LICENSE)。色卡数据的来源见上方说明，不在本许可范围内。
