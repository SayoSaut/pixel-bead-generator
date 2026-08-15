# 库存同步服务（可选）

一个很小的 Cloudflare Worker，让几个人的拼豆库存能跨设备同步，**每人只能读写自己的**。

**不部署这个也能正常用生成器** —— 库存会存在浏览器本地，导出/导入 CSV 也能把数据搬到别的设备。只有想要"自动同步、多人各存各的"时才需要它。

## 花多少钱

免费额度内是 $0：Workers KV 每天 10 万次读、1000 次写、1GB 存储。几个人偶尔改改库存，用量差两个数量级。也不会因为闲置被暂停。

## 部署（全程点网页，不用装任何东西）

Cloudflare 的新版控制台里，创建 Worker 的入口被模板库挤住了，按下面的顺序走就行。

### 1. 先建 KV

打开 <https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces> → **Create instance** → 名字填 `pixel-bead-inventory` → Create。

先建它，因为第 3 步要在下拉框里选它。

### 2. 建 Worker

打开 <https://dash.cloudflare.com/?to=/:account/workers-and-pages> → **Create application** → **Start with Hello World!** → **Get started** → 起名 `pixel-bead-inventory` → **Deploy**。

模板里的代码马上会被替换，随便选。

部署完点 **Edit Code**，把编辑器内容全部删掉，粘贴 [`src/index.js`](src/index.js) 的全部内容，再 **Deploy**。

### 3. 绑定 KV

进这个 Worker → 顶部的 **Bindings 标签页**（跟 Metrics、Settings 并排的那一排，**不在 Settings 里面**）→ **Add binding** → 选 **KV namespace**：

- Variable name：`INVENTORY` ← 必须一字不差
- KV namespace：选第 1 步建的那个

→ **Add binding**

### 4. 设置允许的来源

**Settings** → **Variables and Secrets** → 添加一个 **Text** 类型的变量：

- 名字 `ALLOWED_ORIGIN`
- 值 `https://sayosaut.github.io`（换成你自己的前端地址）

这是 CORS 白名单，别填 `*`。

### 5. 加人

回到第 1 步建的 KV → **KV Pairs** 标签页 → 每个人加一条：

| Key | Value |
| --- | --- |
| `user:lee-8fj3kd92` | `小李` |
| `user:zhang-p2m7xq4b` | `小张` |

**Key 是 `user:` 加上这个人的口令，Value 是他的名字。** 口令由你随便定，只能用字母、数字、`-`、`_`，长度 6–64 位。建议别用生日、名字拼音这类能猜到的，随手敲一串就行。

把 `lee-8fj3kd92` 这一串（不含 `user:` 前缀）发给对应的人，那就是他的口令。

加人 = 加一条 KV Pair；改名 = 改 Value；踢人 = 删掉那条。都是点几下的事。

### 6. 拿地址

回到 Worker 页面，复制顶部的 `https://xxx.workers.dev`。

## 使用

打开生成器 → **管理库存** → 展开 **设置跨设备同步**，填两样：

- **服务器地址**：上一步那个 workers.dev 地址
- **你的专属口令**：管理员分给你的那串

点 **保存并测试连接**，它会真的连一次，成功的话会显示"服务器认出你是「小李」"。

第一次用点「上传到云端」，换了设备点「从云端拉取」。

## 安全模型

**一人一个口令，口令本身就是身份。** 客户端不提交"我是谁"，服务端根据口令查出这次请求属于谁 —— 所以你拿着自己的口令，无论怎么改请求都读不到、也写不坏别人的数据。隔离是服务端强制的。

（早先的版本是全员共用一个口令、客户端自己填档案名，那样只是把数据分开放而已：填别人的名字就能读别人的，名字打错一个字还会静默写到别人头上。）

要清楚它的边界：

- **这不是账号系统**，没有注册、找回、改密。加人踢人靠管理员改 KV
- 口令存在各人浏览器的 localStorage 里，不进代码仓库
- 用 KV Pairs 管理名单时，口令在你的 Cloudflare 控制台里是明文可见的。你自己看得到无所谓；如果介意，改用下面的 secret 方式
- 谁的口令泄露了，删掉那条 KV Pair 换一个新的即可，不影响其他人

### 另一种加人方式：USERS secret

不想让口令在控制台明文可见的话，可以改用加密的 secret：

**Settings** → **Variables and Secrets** → 添加 **Secret** 类型，名字 `USERS`，值是一份 JSON：

```json
{"lee-8fj3kd92":"小李","zhang-p2m7xq4b":"小张"}
```

两种方式都支持，配一种就行。secret 的代价是加个人要重写整份 JSON，所以人多的话 KV Pairs 更顺手。

## 接口

请求都要带 `Authorization: Bearer <口令>`。所有路径都不接受 profile 参数 —— 身份完全由口令决定。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me` | 我是谁 |
| GET | `/api/inventory` | 读我自己的库存 |
| PUT | `/api/inventory` | 写，body 为 `{"inventory":{"A1":12}}` |
| DELETE | `/api/inventory` | 删我自己的档案 |

服务端会校验色号格式、数量范围和条目数量，畸形请求返回 400。

## 测试

在仓库根目录运行：

```bash
node tests/test_worker.mjs
```

用内存版 KV 跑完整条请求路径，覆盖认证、身份解析（KV 名单和 secret 两条路）、**跨用户隔离**、畸形请求和 CORS。
