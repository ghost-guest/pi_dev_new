# Pi Fold UI Support Patch

## 快速开始

```bash
cd /Users/mac_522/Desktop/pi_dev/pi
./patches/setup.sh
```

这会自动：
1. 应用 fold UI support patch
2. 安装 git post-merge hook（`git pull` 后自动重新应用 patch）
3. 验证 fold 扩展

## 功能说明

这个 patch 为 pi 的 `/fold` 扩展添加了 UI 折叠支持。

### 功能
- `/fold` 后，UI 只显示 cutoff point 之后的消息（类似刚启动 pi 的状态）
- `/unfold` 后，UI 恢复显示所有历史消息
- 不影响发送给 LLM 的上下文（只是 UI 显示的变化）

### 实现原理
1. 修改 `interactive-mode.ts`
2. 添加 `getActiveFoldCutoff()`，从 session entries 中读取当前 fold 的 `cutoffEntryId`
3. 添加 `getVisibleSessionContext()`，在当前 branch 上从 cutoff 开始截断 entry 列表
4. 使用 `buildSessionContext(visibleEntries, ...)` 重新构建**仅供 UI 渲染**的会话上下文
5. LLM 真正使用的 session context 不变，所以只是“显示折叠”，不是 compaction，也不是改 session 历史

## 使用方法

### 首次应用 patch

```bash
cd /Users/mac_522/Desktop/pi_dev/pi
chmod +x patches/apply-patches.sh
./patches/apply-patches.sh
```

### 更新 pi 后重新应用

每次从上游拉取更新后，运行：

```bash
cd /Users/mac_522/Desktop/pi_dev/pi
git pull upstream main  # 或你的上游分支
./patches/apply-patches.sh
```

### 如果 patch 冲突

如果上游修改了 `interactive-mode.ts`，patch 可能无法自动应用。此时：

```bash
# 尝试强制应用，生成 .rej 文件
git apply --reject --whitespace=fix patches/fold-ui-support.patch

# 手动合并冲突
# 查看 packages/coding-agent/src/modes/interactive/interactive-mode.ts.rej
# 手动将修改合并到源文件

# 重新生成 patch
git diff packages/coding-agent/src/modes/interactive/interactive-mode.ts > patches/fold-ui-support.patch
```

## 相关文件

- `patches/fold-ui-support.patch` - patch 文件
- `patches/apply-patches.sh` - 自动应用脚本
- `~/.pi/agent/extensions/fold.ts` - fold 扩展（已修复 `ctx.ui.clearChat()` 错误）
- `pi-config/agent/extensions/fold.ts` - fold 扩展备份

## 测试

```bash
# 启动 pi
./pi-test.sh

# 发送几条消息
> test message 1
> test message 2
> test message 3

# 执行 fold
> /fold

# UI 应该只显示欢迎消息和最近的消息

# 执行 unfold
> /unfold

# UI 应该恢复显示所有消息
```

## 注意事项

- 这个 patch 修改了 pi 的核心代码，不是官方支持的功能
- 每次更新 pi 后需要重新应用 patch
- 如果 pi 官方实现了类似功能，可以移除这个 patch
