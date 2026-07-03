import fs from 'fs';
import path from 'path';

const MAX_CONTEXT_FILES = 20;
const MAX_CONTEXT_SIZE = 8000;
const MAX_RULES_SIZE = 16000;
const RULES_FILES = ['DEEPSEEK.md', '.deepseekrules'];

export function buildProjectContext(projectDir: string): string {
  const parts: string[] = [];
  const importantFiles = findImportantFiles(projectDir);

  parts.push(`当前工作区（所有文件操作必须在此目录下）:`);
  parts.push(`${projectDir}`);
  parts.push('');
  parts.push('工具调用的文件路径参数可以是：');
  parts.push(`  1) 绝对路径 — 例如 ${projectDir}/src/main/ipc/files.ts`);
  parts.push(`  2) 相对路径 — 例如 src/main/ipc/files.ts（相对于工作区根目录）`);
  parts.push('注意：路径超出此目录会触发「路径越界」错误。');
  parts.push('');

  let totalSize = 0;
  for (const file of importantFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const truncated = content.length > 400
        ? content.slice(0, 400) + '\n... (截断)'
        : content;
      parts.push(`--- ${path.relative(projectDir, file)} ---`);
      parts.push(truncated);
      totalSize += truncated.length;
      if (totalSize > MAX_CONTEXT_SIZE) break;
    } catch {}
  }

  return parts.join('\n');
}

function findImportantFiles(dir: string): string[] {
  const important = new Set([
    'package.json', 'tsconfig.json', 'README.md',
    '.env.example', 'docker-compose.yml', 'Makefile',
  ]);
  const found: string[] = [];

  function walk(d: string, depth: number) {
    if (depth > 3 || found.length > MAX_CONTEXT_FILES) return;
    try {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(d, entry.name);
        if (entry.isFile() && important.has(entry.name)) {
          found.push(full);
        } else if (entry.isDirectory()) {
          walk(full, depth + 1);
        }
      }
    } catch {}
  }

  walk(dir, 0);
  return found;
}

/**
 * 加载项目根目录的规则文件（类似 Claude Code 的 CLAUDE.md）。
 * 优先级：DEEPSEEK.md > .deepseekrules
 * 读取到的内容会被注入到 system prompt 中，帮助 AI 理解项目约定。
 */
export function loadProjectRules(projectDir: string): string {
  for (const filename of RULES_FILES) {
    const filePath = path.join(projectDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const content = raw.length > MAX_RULES_SIZE
          ? raw.slice(0, MAX_RULES_SIZE) + '\n\n... (内容过长已截断)'
          : raw;
        return content;
      }
    } catch {}
  }
  return '';
}
