# 平台静态模块表（浏览器 bundle 唯一允许 require 的 id，摘自 dsh-web-frontend 启动代码）

react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
zod
@tanstack/react-virtual
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
@deepseek-ai/dsh-client-ui-dockkit

# 参考实现（解包源码）
# 浏览器 bundle（带完整 slot 注册 + fetch + store）:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-session-log-export/lib/client.js
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-session-log/lib/client.js
# 设置页组件（含 hooks/inject 示例）:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-subagent/lib/client.js
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-client-ui-agent-preset/lib/client.js
# 侧边栏 footer 按钮（Cordis 面板）:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-client-ui-cordis/lib/client.js
# 宿主侧路由注册:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-session-log-export/lib/index.js
# 工具注册（普通对象）:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js
# session 持久化服务:
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js
#   .tmp/dsh-src/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js
