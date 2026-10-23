# dsh-liaobots-balance

[![CI](https://github.com/Lithane/dsh-liaobots-balance/actions/workflows/ci.yml/badge.svg)](https://github.com/Lithane/dsh-liaobots-balance/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Lithane/dsh-liaobots-balance?style=flat-square)](https://github.com/Lithane/dsh-liaobots-balance/blob/main/LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.1.2%20--%200.2.x-blue?style=flat-square)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![Zero deps](https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat-square)]()

给 DeepSeek Harness GUI 用的 **Liaobots 余额插件**：在侧边栏底部显示 Liaobots 剩余积分，
点开弹层可以看到总额度、低额度预警，以及最近的扣费记录。

界面沿用你现在用的 `dsh-balance-widget`（DS 余额卡片）的样式：同样的圆角卡片、
同样的收窄成图标栏的行为、同样的弹层与刷新按钮，只是品牌文案改成 `LB账户余额`，
数据换成 Liaobots。

```
侧边栏底部                    点开弹层
┌───────────────────────┐     ┌───────────────────────────┐
│ LB账户余额      85.5  │     │ Liaobots 余额           × │
│ 总积分           100  │     │ 剩余积分 ⓘ          85.5  │
└───────────────────────┘     │ 总积分   ⓘ           100  │
                              │ 最近扣费                  │
                              │ gpt-6-luna  -0.12  10-01 12:30 │
                              │ 去充值              ⟳     │
                              └───────────────────────────┘
```

## 在 DSH 插件列表里的显示名

DSH 的插件列表**不读卡片上的文案**：它按条目的模块标识取显示名，先看包内导出的
`locale/<语言>.json` 里的 `meta.title` / `meta.description`，没有才回退到包名或模块名。

* 侧栏「插件」页（组合包卡片）：回退显示**完整包名** → `dsh-liaobots-balance`
* 设置 →「插件」→「插件列表」：回退显示**去掉 `dsh-` 前缀的短名** → `liaobots-balance`

所以本插件提供了 `locale/en.json` 与 `locale/zh.json`：

```json
{ "meta": { "title": "Liaobots 余额", "description": "在侧边栏底部显示 Liaobots 剩余积分…" } }
```

配合 `package.json` 的 `exports["./locale/*.json"]`，列表里就会显示成 **Liaobots 余额**（中文界面）
/ **Liaobots Balance**（英文界面），而不是模块名。卡片上的 `LB账户余额` 只是控件内部的品牌文案，
和插件名无关。

## 侧边栏里的排列方式

DSH 的 `sidebar.footer.action` 槽位是一个**不换行的 flex 行**，所以两张都想占满一整行的
余额卡片会被各自压成半行、左右并排。（DS 余额卡 `dsh-account-balance` 的根元素现在是 `flex: 1 1 100%`。）

本插件默认把卡片改成**上下排列**，做法是两条：

* 自己的根元素加 `flex: 1 1 100%`（`data-stack="true"`）——声明要占满一整行；
* 挂载时给**真正的 flex 行**加上内联 `flex-wrap: wrap`（卸载或 `stackCards: false` 时还原）——
  允许换行，于是本卡片掉到 DS 余额卡下面。

### ⚠️ 两个必须遵守的细节

**1. `el.parentElement` 不是那一行。** DSH 会在槽位条目外面包一层 `display: contents` 的出口容器——
它**不生成盒子**，所以往它上面写 `flex-wrap` 会被完全忽略（`getComputedStyle` 读出来是 `wrap`，
但没有任何布局效果）。必须从卡片往上爬到最近的 `getComputedStyle(x).display === "flex"` 祖先。
DS 余额卡（`dsh-account-balance`）用的是**同一套协议**。

**2. 在那一行上做引用计数，而不是"先到先得"。** 卡片把自己登记在行元素的
`__dshBalanceCardWrap` 属性上（`{ count, previous }`，**这是与 DS 余额卡约定的跨插件契约**）：
首个声明者记录 `style.flexWrap` 原值并打开换行，**最后一个**离开的还原。因此：

* 两个插件同时存在 → 计数为 2，互不抢占；
* **卸载或关闭任意一个 → 计数降到 1，另一个仍然正常上下排列**；
* 只装一个 → 卸载时计数归零，干净还原原值；
* 任意卸载顺序都成立——这正是用引用计数、而不是"谁先拥有谁还原"的原因。

⚠️ 曾经用过"行内已无其它子元素"作为释放条件，那是**错的**：那一行只挂着一个
`display: contents` 出口容器，`childElementCount` 恒为 1，会让**单独一张卡也永不还原**
（本插件的两项前端测试因此失败，改为引用计数后 18/18 通过）。

不这么做而只改自己的 `flex` 是不行的：那一行是 `nowrap`，第二张卡片会被压扁而不是换行。

**注意 `stackCards: false` 现在也回不到左右并排**——DS 余额卡无条件声明占满整行，那一行仍会换行。
想真正并排需要两边一起退让（DS 改回 `1 1 auto` 并去掉换行逻辑）。

## 数据来源

按官方文档 [API 调用示例 → 查询余额](https://docs.liaobots.work/Getting-Started/cn/API) 实现：

| 项目 | 值 |
| - | - |
| 余额接口 | `GET {base}/api/v1/credits`（等价 `GET {base}/v1/credits`） |
| 认证 | `Authorization: Bearer <登录码>` |
| 返回 | `{"data":{"balance":85.5,"amount":100.0}}`，`balance` 剩余积分、`amount` 累计总额度 |
| 扣费记录 | 同一接口加 `include_usage=true&pageSize=N`，返回 `data.usage.{pageSize,nextId,list[]}` |
| 网关域名 | 主域名 `https://ai.liaobots.work`，备用 `ai.liaobots1.work` / `ai.liaobots2.work` / `ai.liaobots3.work` |

插件默认走 `https://ai.liaobots1.work`（`dsh-balance-widget` 同款的备用域名，实测主域名在部分网络下不通），
并自带**域名故障转移**：某个域名连不上/报错就自动试下一个，之后优先复用上次成功的域名。

## 安全边界

* 登录码只在 **宿主进程** 里解析（走 DSH 的 credentials 服务，与 `dsh-llm` 同一套机制），
  永远不会下发到浏览器；
* 浏览器只访问两个**同源、仅限本机回环**的路由，非 127.0.0.1 的请求直接 403；
* 插件没有任何外部依赖（宿主端零 import），也不需要联网安装依赖。

## 安装

前提：DSH 桌面版（profile `desktop`），Node ≥ 22。本插件还没发布到 npm，所以用 Git 地址或本地路径安装。

### 从 GitHub 仓库安装（推荐）

```powershell
git clone https://github.com/Lithane/dsh-liaobots-balance.git
cd dsh-liaobots-balance

# 1) 把插件装进 profile（等价于 GUI 插件管理器的安装动作）
#    link: = 在 profile 里建立指向本仓库的链接，改完源码重启即生效
#    想要一份不再跟随源码改动的独立副本，就把 link: 换成 file:
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" `
  plugin --profile desktop add "link:$PWD"

# 2) 确认 bundle 已登记进 profile 清单（package.json → dsh.profile.bundles）
#    dsh plugin add 通常会自动登记；这条命令只做兜底，已登记时直接退出
node scripts\enable-in-profile.mjs desktop

# 3) 重启 DSH 应用（宿主端与前端两半都只在启动时加载）
```

桌面版侧边栏的「插件」面板等价：**添加插件**接受包名（可带版本）、Git 地址、压缩包或本地绝对路径，
把上面 clone 出来的仓库路径填进去即可。装完同样要重启。

也可以手动把仓库路径加进 `~/.dsh/profiles/desktop/package.json` 的依赖与 `dsh.profile.bundles`，
第 2 步的 `scripts/enable-in-profile.mjs` 做的就是这件事（改 profile 文件前会先备份成 `package.json.bak-<时间戳>`）。

装好后可以这样确认 profile 真的包含这个插件行：

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1) 依赖与 bundle 清单里都应当出现 dsh-liaobots-balance
Get-Content "$p\package.json" | Select-String dsh-liaobots-balance

# 2) 链接应当指向本仓库（LinkType = Junction，Target = 本仓库路径）
Get-Item "$p\node_modules\dsh-liaobots-balance" | Select-Object LinkType, Target

# 3) 最直接的证据：在对话里问一句余额，宿主半会用 liaobots_balance 工具回答
```

⚠️ `dsh --profile desktop --dump-config` 在这里**不管用**：`desktop` profile 由 Electron 应用独占管理，
这条命令会直接报 `error: profile "desktop" is managed exclusively by the Electron application` 并退出 1。
`--dump-config` 只适用于非 Electron 管理的 profile（`web` / `tui` 等）。
第 2 步还有两个前提：链接不是指向旧目录名的悬空 junction（改名/移动过仓库后要重新 `dsh plugin add "link:…"`），
且 `dsh.profile.bundles` 里有这个包名（`dsh plugin add` 通常会自动登记，`enable-in-profile.mjs` 是兜底）。

卸载：

```powershell
node scripts\enable-in-profile.mjs desktop --remove
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-liaobots-balance
```

### DSH 版本闸门（peer）：升级前先预检

DSH 启动时会拿本插件的 `peerDependencies["@deepseek-ai/dsh"]` 与**运行中的 DSH 版本**比对
（预发布版本也参与匹配）。**不匹配且未豁免的 bundle 会被静默跳过**——只记进 `skippedBundles`，
不报错：表现为卡片和两条路由**整体消失**，日志里没有任何线索。上游 `dsh-balance-widget`
就为此把范围从 `<0.2.0` 放宽到 `<0.3.0`（这道闸门自 DSH 0.2.0 起才有）。

当前范围：`>=0.1.2-rc.1 <0.3.0`。**升级 DSH 前**先拿目标版本号跑一次预检：

```powershell
node test\package.test.mjs 0.3.0    # 最后一项即"peer 范围是否接受该运行时"
```

不通过就说明升级后插件会消失：确认新版本确实可用后再放宽 `package.json` 里的范围。

### 登录码

默认从 DSH 凭据里读 `LIAO_API_KEY`（也就是你 profile 里 `liao` 提供方用的那个 Key）。
如果读不到，会依次退回启动环境变量、进程环境变量。想在别处放 Key 时改名即可：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: liaobots-balance
  name: 'dsh-liaobots-balance'
  config:
    apiKeyEnv: MY_LIAO_CODE
```

## 配置项

写在 profile 的 `cordis.patch.yml`（追加一条与上面同 id 的覆盖项即可）：

| 键 | 默认值 | 说明 |
| - | - | - |
| `baseURL` | `https://ai.liaobots1.work` | 首选网关域名 |
| `fallbackBaseURLs` | `["https://ai.liaobots.work", "...liaobots2.work", "...liaobots3.work"]` | 故障转移候选（可写数组或逗号分隔字符串） |
| `apiKeyEnv` | `LIAO_API_KEY` | 登录码在凭据库里的名字 |
| `requestTimeoutMs` | `8000` | 单个域名的请求超时 |
| `refreshIntervalMs` | `60000` | 卡片自动刷新间隔（下限 5000） |
| `usagePageSize` | `10` | 弹层请求的扣费记录条数（上限 100） |
| `lowThreshold` | `5` | 剩余积分低于该值，余额文字转为黄色；按余额绝对值判断，与占比无关 |
| `criticalThreshold` | `1` | 剩余积分低于该值，余额文字转为红色并提示立即充值 |
| `topUpURL` | `https://liaobots.work` | 弹层「去充值」打开的地址 |
| `stackCards` | `true` | 侧边栏布局：`true` 时本卡片独占整行（`flex: 1 1 100%`）并登记让 footer 那行换行，于是排在 DS 余额卡**下方**（上下分布）。`false` 时本卡片完全不参与（不声明整行、也不登记换行）；但**只要 DS 余额卡在场，那一行仍会换行**，所以不会回到左右并排 |

## 宿主端接口

| 路由 | 说明 |
| - | - |
| `GET /api/dsh-liaobots/balance` | 余额：`{ok, balance, amount, used, remainingRatio, host, fetchedAt, lowThreshold, criticalThreshold, topUpURL}` |
| `GET /api/dsh-liaobots/usage?pageSize=N` | 余额 + 最近扣费：`usage.{list[],nextId,pageSize}` |

失败时返回 `{ok:false, code, error}`，`code` ∈ `no-credentials` / `auth` / `payment` / `unreachable`。
两个路由都是回环限定 + 15~30 秒短缓存，前端 60 秒轮询与弹层首屏共用同一次上游请求。

插件还会注册一个给模型用的工具 `liaobots_balance`（`query = balance | usage | both`），
所以你可以直接在对话里问「我的 Liaobots 余额还剩多少」。

`ctx` 上的服务**必须**用 `ctx.get(name)` 读取，不能写成 `ctx.tools` 这样的属性访问：
Cordis 只允许读 `inject` 里声明过的服务，读未声明的会抛
`cannot get property "tools" without inject`。本插件的 `inject` 只有 `webServer`，
所以工具走 `ctx.get("tools")`——服务存在就注册，不存在就跳过，卡片照常挂载。
另外宿主工具注册表要求定义里带 `output { schema, render }`（只有
`name/description/parameters/execute` 会被 `ToolRuntime.register` 拒绝），
所以这里手写了这两项（`parameters` 与 `output.schema` 都是原始 JSON Schema）。

### 重复挂载（重新组合）时的注册

DSH 在插件管理器改动 profile 后会**重新组合**插件树，这一次重组可能在旧的挂载还活着时
再应用本插件一遍。宿主 webserver 对同一 `(kind, path)` 是硬报错的
（`webserver: duplicate exact route ...`，见 `dsh-host-webserver`），于是那一遍会被记为
`did not activate` 并弹一条 warning——尽管第一次注册的路由一直在正常服务。

所以路由和 agent 工具都走**按挂载计数的认领**（`claimRegistration` / `claimRoute` / `claimTool`）：

* 第一次认领才真正注册；后来的认领**复用**已经在服务的注册（后面的处理器本来就是本插件的）；
* 参照计数，最后一个离开的注销；**先离开的旧挂载不会把路由从认领它的新挂载手里拿走**；
* 认领表挂在 `globalThis[Symbol.for(...)]` 上，**同进程所有模块副本共享**（HMR 会加载新副本）；
* 只容忍"重复且报错里点名了本插件自己的路径"这一种失败；其它错误照旧抛出，并在抛出前
  注销这次已经认领的一切（路由与工具），避免残留到下一次挂载再撞车。

这正是"单纯跳过重复注册"会踩的坑：跳过之后旧挂载一卸载，路由就整体消失了。

## 测试

```powershell
node test\host.test.mjs            # 宿主端 26 项：路由、回环围栏、凭据、解析、故障转移、缓存、工具契约、重复挂载/跨实例共享/未声明服务
node test\host.test.mjs --live     # 追加一次真实网关探测（用无效登录码，预期归类为 auth）
npm run test:install               # 测试依赖（jsdom + react + semver），装在 test\ 里，与插件包隔离
node test\client.test.mjs          # 前端 19 项：真实 jsdom 挂载、卡片/弹层文案、阈值、错误态、轮询间隔、上下排列、图标回退
node test\package.test.mjs         # 打包元信息 7 项：exports 解析、locale 展示元信息、bundle patch、DSH peer 兼容、零依赖
node test\package.test.mjs 0.3.0   # 换一个 DSH 版本号跑同一套，用于升级前的 peer 预检
npm test                           # 上面三套一起跑（52 项），等价于 CI
```

`package.test.mjs` 要用到 `semver`（也来自 `test/`），所以 `npm run test:install`（或 `cd test; npm ci`）
得排在它和 `client.test.mjs` 之前；`host.test.mjs` 零依赖，可以最先跑。CI
（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在 Ubuntu 与 Windows 上按 Node 22 / 24 各跑一遍这三套，
最后再加一条 `npm pack --dry-run` 守住发布内容（只有 `lib/`、`locale/`、补丁和 README，不含测试依赖）。

`test/` 只放测试依赖，**插件本身不在这里作为依赖**：那行 `"dsh-liaobots-balance": "file:.."`
曾让 `test/node_modules/dsh-liaobots-balance` 变成指回工作区根的 junction，于是
"已安装的包"（profile 用 `link:`）里套着它自己——跟随符号链接的递归扫描会一直下钻。
如果哪次 `npm install` 之后它又出现了，这样收尾：

```powershell
cmd /c rmdir "test\node_modules\dsh-liaobots-balance"   # 只删链接，不进目标
Remove-Item "test\node_modules\.package-lock.json" -Force  # npm 的隐藏锁，会按旧状态反写清单
# 再确认 test\package.json 与 test\package-lock.json 里没有 "dsh-liaobots-balance"
```

前端测试会真的把 `lib/client.js` 交给 `window.__ModuleLoader__.load`，再用 React 挂载、
stub `fetch`，断言渲染出来的 DOM —— 不是文本比对的假测试。

## 目录

```
lib/index.js                 宿主端：两条回环路由 + 凭据解析 + 域名故障转移 + 缓存 + agent 工具
lib/client.js                前端：侧边栏卡片与弹层（无构建步骤，直接由 GUI 加载）
locale/en.json              插件列表里的英文显示名与说明（meta.title / meta.description）
locale/zh.json              插件列表里的中文显示名与说明
cordis.patch.yml             bundle 补丁：把插件行插进 profile roster
scripts/enable-in-profile.mjs 把 bundle 登记进 profile 清单
scripts/asar.mjs             只读查看 DSH 安装包（app.asar）内文件的小工具，排查插件列表问题用
test/host.test.mjs           宿主端测试
test/client.test.mjs         前端渲染测试
test/package.test.mjs        打包/展示元信息测试
test/package.json           测试依赖清单（插件本身不是它的依赖）
.github/workflows/ci.yml     CI：三套测试 × Ubuntu/Windows × Node 22/24
CHANGELOG.md                 版本历史
LICENSE                      MIT
```

## 排错

| 现象 | 原因与处理 |
| - | - |
| 卡片显示 `—`，弹层提示「未找到登录码 LIAO_API_KEY」 | profile 里没有可解析的 Liaobots Key：在 DSH 设置里给 `liao` 提供方填 Key，或设置 `LIAO_API_KEY` 后重启 |
| 弹层提示「登录码无效：user not found」 | 登录码本身无效/过期，去 Liaobots 后台重新复制 |
| 弹层提示「无法连接 Liaobots 网关：… 连接超时」 | 当前网络到所有网关域名都不通：挂代理，或在配置里把 `baseURL` 换成实测可用的域名 |
| 侧边栏没有这张卡 | 宿主端没加载：先按「安装」一节的 3 步核对（依赖/清单里有它、`node_modules` 下的链接不是悬空 junction），然后重启 DSH。`dsh --profile desktop --dump-config` 对 `desktop` profile **不可用**（Electron 独占管理，会报错退出） |
| **升级 DSH 后**卡片与两条路由一起消失、日志里毫无线索 | peer 闸门把 bundle 静默跳过了（只记 `skippedBundles`）：用 `node test\package.test.mjs <新版本>` 预检，确认新版本可用后放宽 `peerDependencies["@deepseek-ai/dsh"]`（见「DSH 版本闸门」） |
| 两张卡片还是左右并排 | 前端 bundle 还是旧的：先刷新页面（Ctrl+R），仍然并排就重启 DSH。若确认已加载新版仍并排，说明换行写到了 `display: contents` 的出口容器上（见「侧边栏里的排列方式」第 1 点） |
| 插件列表里找不到这张卡片 | 列表用的是模块名而不是卡片文案：看 `liaobots-balance`（设置→插件列表）或 `dsh-liaobots-balance`（侧栏插件页的已安装分组）。装上本仓库的 `locale/*.json` 后显示为 **Liaobots 余额**；设置里的清单是打开时取一份快照，重开设置页即可刷新 |
| 开关插件时弹 `dsh: warning: 1 entry did not activate … duplicate exact route` | 重组在旧挂载还活着时又挂了一遍本插件。需要**重新加载宿主半**（改的是 `lib/index.js`，重启 DSH 生效）；加载新版后这一条不会再弹，插件在重启之前也不会因此掉线 |
| 弹 `1 entry did not activate … cannot get property "tools" without inject` | 把可选服务写成了属性访问（`ctx.tools`）。Cordis 只允许属性访问 `inject` 里声明的服务；可选服务一律用 `ctx.get("tools")`。改宿主半后重启 DSH |
| 卡片正常但没有 `liaobots_balance` 工具 | 该组合里没有 `tools` 服务时工具会跳过（不报错）；有服务时仍注册失败，日志里会有 `tool registration failed`，按提示改定义（必须带 `output { schema, render }`） |

## 致谢

* 界面样式与侧边栏布局协议参照 [LL-cmyk-so/dsh-balance-widget](https://github.com/LL-cmyk-so/dsh-balance-widget)（DS 余额卡片，同为 MIT）；
* 余额接口依据 [Liaobots 官方 API 文档](https://docs.liaobots.work/Getting-Started/cn/API)。

## License

[MIT](LICENSE) © 2026 Li Yi (thliyi@live.com)

版本历史见 [CHANGELOG.md](CHANGELOG.md)，仓库地址 <https://github.com/Lithane/dsh-liaobots-balance>。
