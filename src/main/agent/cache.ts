import crypto from 'crypto';

export interface SystemPromptParts {
  base: string;
  roles: string;
  plugins: string;
  command: string;
}

export interface CachePrefix {
  parts: SystemPromptParts;
  projectContext: string;
  rules: string;
}

let cachedPrefix: CachePrefix | null = null;
let lastHash = '';

function hash(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

export function buildCachePrefix(
  parts: SystemPromptParts,
  projectContext: string,
  rules: string,
): CachePrefix {
  const h = hash(parts.base + parts.roles + parts.plugins + parts.command + projectContext + rules);
  if (h === lastHash && cachedPrefix) return cachedPrefix;
  cachedPrefix = { parts, projectContext, rules };
  lastHash = h;
  return cachedPrefix;
}

/**
 * 构建发送给 LLM 的消息列表。
 *
 * **缓存友好设计（DeepSeek 前缀匹配缓存）**：
 * - [0] 基础 system prompt — 每个模式固定不变，**始终命中缓存**（10% 计费）
 * - [1] 角色 + 插件 — 同 session 内稳定，跨 session 变化小
 * - [2] 项目上下文 — 文件改动时才变化
 * - [3] 命令模式提示 — 切换 /command 时变化
 * - 可变内容放在独立消息中，避免破坏 [0] 位置的前缀稳定性
 */
export function buildMessages(
  prefix: CachePrefix,
  history: Array<{ role: string; content: string | any[] }>,
  newMessage: string | any[],
) {
  const { parts, projectContext, rules } = prefix;
  const messages: Array<{ role: string; content: string | any[] }> = [];

  // [0] 基础 system prompt — 永远不变，前缀缓存的核心
  messages.push({ role: 'system', content: parts.base });

  // [1] 角色 + 插件 — 同一 session 内稳定
  const extras: string[] = [];
  if (parts.roles) extras.push(parts.roles);
  if (parts.plugins) extras.push(parts.plugins);
  if (extras.length > 0) {
    messages.push({ role: 'system', content: extras.join('\n\n') });
  }

  // [2] 项目上下文
  if (projectContext) {
    messages.push({ role: 'system', content: `## 项目上下文\n\`\`\`\n${projectContext}\n\`\`\`` });
  }

  // [2b] 项目规则（DEEPSEEK.md / .deepseekrules）
  if (rules) {
    messages.push({ role: 'system', content: `## 项目规则\n以下是项目根目录中 \`DEEPSEEK.md\`（或 \`.deepseekrules\`）定义的规则，你必须遵守：\n\n${rules}` });
  }

  // [3] 命令模式
  if (parts.command) {
    messages.push({ role: 'system', content: `## 当前命令模式\n${parts.command}` });
  }

  // 历史消息 + 新用户消息
  messages.push(...history);
  messages.push({ role: 'user', content: newMessage });
  return messages;
}
