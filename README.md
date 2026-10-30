# kcd2-dice —《天国拯救2》骰子游戏（Farkle）联机复刻

纯网页、6 位房间码 + 权威服务器、2 人对战。服务端权威判骰、管状态、防作弊。
核心 Farkle 规则 + 恶魔之首万能骰 + 10 种特殊骰子 + 锡/银/金徽章各 1 种 + 虚拟金币下注。

## 功能清单

- 轻量账号：昵称 + 密码（bcrypt 哈希，JWT 会话），可留战绩与金币
- 房间码邀请：创建房间 → 分享 6 位码 → 对方输入加入 → 双方准备开局
- 对局：开局掷 6 骰 → 勾选计分骰 → 掷剩余骰继续 / 存分过 → 爆掉归零换手
- 特殊骰 11 种：普通、恶魔之首、幸运、奇数、偶数、天堂、阿兰卡、三一、不幸、路之骰、谨慎作弊
- 徽章 3 种（双方同 tier 才生效）：锡·复活（爆掉后重掷同批骰子 1 次/局）、银·军阀（本回合存分 ×1.5，1 次/局）、金·军阀（×2，1 次/局）
- 虚拟金币：初始 500，下注 10..余额，赢家拿奖池；目标分 2000 / 4000 / 6000 可选
- 服务端权威：骰面由服务器生成并广播，客户端只渲染；回合限时 60s；掉线 90s 内重连，超时判负

## 技术栈与结构

npm workspaces（根 `package.json`）：

| 包 | 内容 |
|---|---|
| `shared` | 冻结类型契约 + 规则引擎（计分/组合/爆掉/骰池），vitest 40 用例 |
| `server` | Express + Socket.IO 权威服务器，vitest 11 用例（含完整对局、退款、复活徽章） |
| `client` | React + Vite + TS，羊皮纸风界面，状态唯一来源 roomUpdate |

## 本地运行

要求：Node.js ≥ 20（本机实测 npm 12）。

```bash
# 1. 安装（本机全局 npm 缓存不可写，已通过根 .npmrc 指定项目内缓存）
npm install

# 2. 终端 A：启动服务器（http://localhost:3001）
npm run dev:server

# 3. 终端 B：启动前端（http://localhost:5173，已代理 /api 与 /socket.io 到 3001）
npm run dev:client
```

打开 http://localhost:5173，注册两个账号（或用两个浏览器/隐身窗口），一方创建房间、另一方输入房间码加入，双方准备后开局。

测试与类型检查：

```bash
npm run test              # shared 40 + server 11
npm run typecheck -w @kcd2dice/shared
npm run typecheck -w @kcd2dice/server
npm run typecheck -w @kcd2dice/client
npm run build -w @kcd2dice/client
```

## 免费云部署（Render，推荐）

1. 代码推到一个 GitHub 仓库（项目当前不是 git 仓库，先 `git init` 提交）。
2. Render 新建 **Web Service**，连该仓库：
   - Build Command：`npm install && npm run build -w @kcd2dice/client`
   - Start Command：`npm run start -w @kcd2dice/server`
   - 实例选 Free 即可
3. 部署后把生成的公网 URL（如 `https://xxx.onrender.com`）填入 `client/vite.config.ts` 的两个代理目标（`/api` 与 `/socket.io`），再重新部署，或改用生产构建配置指向该地址。
4. 两个玩家打开同一个公网 URL 即可联机。

> 注意：Render Free 实例闲置 15 分钟会休眠，冷启动约 30–60s；多人实测建议付费实例或换 Railway/Fly.io 同款步骤。

## 计分规则速查

- 单个 1 = 100，单个 5 = 50
- 三个同点 = 点数 ×100（三个 1 = 1000）；4/5/6 同点每多一个 ×2/×4/×8
- 顺子：1-5 = 500、2-6 = 750、1-6 = 1500
- 恶魔之首 = 万能骰：只能补顺子或补 3+ 同点（该组合须含 ≥1 真实面骰），不能单独计分
- 某次掷出无任何得分组合 = 爆掉，本回合未存分清零
- 6 骰全用可重掷 6 颗继续累计（hot dice）

## 已知取舍

- 本回合首次选中计分骰后须先「掷骰」把分锁入，才能「存分过」结束回合（v1 设计）。
- 中文界面与羊皮纸风骰子均为原创绘制，不复制 KCD2 素材。
- 徽章每局次数由服务器裁定：复活 1 次/局、军阀 1 次/局；双方须装备同 tier 徽章。
