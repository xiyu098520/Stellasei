# 星绥 Stellasei

一部住在手机里的虚拟手机（PWA）。打开是一个手机主屏幕，里面有一套自己的 App：星绥通讯、档案、世界书、记忆、美化、设置。

## 技术栈

- Next.js 16（App Router，`output: "export"` 纯静态导出）
- React 19、Tailwind CSS 4、TypeScript
- 数据全部落在浏览器 IndexedDB，无账号、无服务端数据库

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:3000 。

手机真机调试：让手机与电脑在同一局域网，访问 `http://<电脑IP>:3000`（`next.config.ts` 的 `allowedDevOrigins` 里已放行 `192.168.1.2`，路由器换了 IP 要同步改一处）。

## 构建与部署

```bash
npm run build   # 产物在 out/
```

推送到 `main` 后，由 `.github/workflows/deploy-pages.yml` 构建并发布到 GitHub Pages：
`https://<用户名>.github.io/Stellasei/`（构建时注入 `NEXT_PUBLIC_BASE_PATH=/Stellasei`）。

## 目录

```
src/app          页面入口、全局样式、PWA manifest
src/apps         各 App 本体（chat / contacts / worldbook / memory / ...）
src/components   手机外壳、视窗管理、通用组件
src/lib          数据层与工具（IndexedDB、提示词组装、设定读写）
server-api       接口脚本
public           静态资源（塔罗牌面、图标、证书）
```

## 说明

对话与生图所用的接口地址、密钥都在应用内的设置页填写，不进仓库（`.env*` 已忽略）。
