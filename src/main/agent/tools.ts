import type { ToolDef, ToolContext } from './tools/index';
export type { ToolDef, ToolContext };

import { createReadFileTool } from './tools/read-file';
import { createWriteFileTool } from './tools/write-file';
import { createEditFileTool } from './tools/edit-file';
import { createGrepTool } from './tools/grep';
import { createGlobTool } from './tools/glob';
import { createBashTool } from './tools/bash';
import { createListFilesTool } from './tools/list-files';
import { createSpawnSubAgentTool } from './tools/spawn-sub-agent';
import { createSpawnRoleAgentsTool } from './tools/spawn-role-agents';
import { createWritePlanTool } from './tools/write-plan';
import { createWriteTodosTool } from './tools/write-todos';
import {
  createCloudListSessionsTool,
  createCloudPushSessionTool,
  createCloudPullSessionTool,
} from './tools/cloud-sync';
import { createAutoDecomposeTaskTool } from './tools/auto-decompose-task';
import { createBrowseUrlTool } from './tools/browse-url';
import { createWebSearchTool } from './tools/web-search';
import { createWebFetchTool } from './tools/web-fetch';
import { createWebScreenshotTool } from './tools/web-screenshot';
import { createPresentWebTool } from './tools/present-web';
import { createPresentChoicesTool } from './tools/present-choices';
import { createGenerateImageTool } from './tools/generate-image';
import { createDescribeImageTool } from './tools/describe-image';
import {
  createGitAddTool,
  createGitCommitTool,
  createGitDiffTool,
  createGitFetchTool,
  createGitLogTool,
  createGitPullTool,
  createGitPushTool,
  createGitStatusTool,
} from './tools/git';

const SUB_AGENT_EXCLUDED_TOOLS = new Set([
  'spawn_sub_agent',
  'auto_decompose_task',
  'write_todos',
  'bash',
  'generate_image',
  'browse_url',
  'present_web',
  'present_choices',
  'git_add',
  'git_commit',
  'git_pull',
  'git_push',
  'cloud_list_sessions',
  'cloud_push_session',
  'cloud_pull_session',
]);

export function getAllTools(projectDir: string): ToolDef[] {
  return [
    createReadFileTool(projectDir),
    createWriteFileTool(projectDir),
    createEditFileTool(projectDir),
    createGrepTool(projectDir),
    createGlobTool(projectDir),
    createBashTool(projectDir),
    createListFilesTool(projectDir),
    createSpawnSubAgentTool(projectDir),
    createAutoDecomposeTaskTool(projectDir),
    createBrowseUrlTool(),
    createWebSearchTool(),
    createWebFetchTool(),
    createWebScreenshotTool(),
    createPresentWebTool(),
    createPresentChoicesTool(),
    createGenerateImageTool(),
    createDescribeImageTool(),
    createGitStatusTool(projectDir),
    createGitDiffTool(projectDir),
    createGitAddTool(projectDir),
    createGitCommitTool(projectDir),
    createGitLogTool(projectDir),
    createGitFetchTool(projectDir),
    createGitPullTool(projectDir),
    createGitPushTool(projectDir),
    createWriteTodosTool(),
    createCloudListSessionsTool(),
    createCloudPushSessionTool(),
    createCloudPullSessionTool(),
  ];
}

/** 子代理仅保留读/搜/改文件能力，避免嵌套派生与高风险工具 */
export function getSubAgentTools(projectDir: string): ToolDef[] {
  return getAllTools(projectDir).filter(t => !SUB_AGENT_EXCLUDED_TOOLS.has(t.name));
}

/** Plan 模式：只读分析 + 仅能写计划文档，禁用改代码/bash/git 写/spawn */
const PLAN_MODE_TOOLS = new Set([
  'read_file', 'grep', 'glob', 'list_files',
  'web_search', 'web_fetch', 'web_screenshot', 'describe_image',
  'git_status', 'git_diff', 'git_log',
  'write_todos',
  'present_choices', 'present_web',
]);

/** 按 Agent 模式返回可用工具集 */
export function getToolsForMode(mode: string | undefined, projectDir: string): ToolDef[] {
  if (mode === 'roleplay') return [];
  if (mode === 'plan') {
    return [
      ...getAllTools(projectDir).filter(t => PLAN_MODE_TOOLS.has(t.name)),
      createWritePlanTool(projectDir),
    ];
  }
  if (mode === 'multi-agent') {
    return [...getAllTools(projectDir), createSpawnRoleAgentsTool(projectDir)];
  }
  // agent / chat / 其它：全量工具
  return getAllTools(projectDir);
}

/** 返回按函数名排序的工具 schema，确保每次序列化结果一致，有利于 DeepSeek 缓存前缀命中 */
export function getToolSchemas(tools: ToolDef[]) {
  return tools
    .map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    .sort((a, b) => a.function.name.localeCompare(b.function.name));
}
