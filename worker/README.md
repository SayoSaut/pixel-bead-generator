# 库存同步服务（可选）

一个很小的 Cloudflare Worker，让几个人的拼豆库存能跨设备同步。

**不部署这个也能正常用生成器** —— 库存会存在浏览器本地。只有需要"换台电脑还能看到自己的库存"时才需要它。

## 花多少钱

免费额度内是 $0：Workers KV 每天 10 万次读、1000 次写、1GB 存储。几个人偶尔改改库存，用量差两个数量级。也不会像某些免费方案那样因为闲置被暂停。

## 部署

需要一个 Cloudflare 账号和 Node。

```bash
cd worker
npm install -g wrangler
wrangler login
```

**1. 建 KV namespace**

```bash
wrangler kv namespace create INVENTORY
```

把输出里的 `id` 填进 `wrangler.toml` 的 `kv_namespaces` 段。

**2. 改允许的来源**

`wrangler.toml` 里的 `ALLOWED_ORIGIN` 改成你的前端地址，例如 `https://sayosaut.github.io`。这是 CORS 白名单，别留 `*`。

**3. 设置口令**

```bash
wrangler secret put PASSCODE
```

会提示你输入，输入的内容不会写进任何文件，也就不会进仓库。

**4. 部署**

```bash
wrangler deploy
```

结束后会打印一个 `https://pixel-bead-inventory.<你的子域>.workers.dev` 地址。

## 使用

打开生成器 → 管理库存 → 展开「跨设备同步」，填三样东西：

- **服务器地址**：上一步那个 workers.dev 地址
- **共享口令**：你设的 PASSCODE
- **档案名**：每个人填自己的名字，各存各的

点「保存设置」，然后「从云端拉取」或「上传到云端」。打开「改动后自动上传」的话，改完库存 2.5 秒后会自动传一次（合并连续改动，省写入次数）。

## 安全模型

认证是**一个共享口令**，不是账号系统。对"就几个熟人"这个规模，账号系统要处理注册、找回、发邮件，成本远超它解决的问题。

要清楚它的边界：

- 拿到口令的人**能读写所有档案**，档案名之间没有隔离，别当成隐私保护
- 口令只存在各自浏览器的 localStorage 里，不进仓库
- 口令泄露了就 `wrangler secret put PASSCODE` 换一个，所有人重填一次

如果哪天需要真正的账号隔离，得换成带认证的方案（比如 Supabase），那是另一套东西了。

## 接口

所有请求都要带 `Authorization: Bearer <口令>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/profiles` | 列出所有档案名 |
| GET | `/api/inventory?profile=名字` | 读某个档案 |
| PUT | `/api/inventory?profile=名字` | 写，body 为 `{"inventory":{"A1":12}}` |
| DELETE | `/api/inventory?profile=名字` | 删除档案 |

服务端会校验色号格式、数量范围和条目数量，畸形请求返回 400。

## 测试

```bash
node tests/test_worker.mjs   # 在仓库根目录运行
```

用内存版 KV 跑完整条请求路径，覆盖认证、校验、多档案隔离和 CORS。
