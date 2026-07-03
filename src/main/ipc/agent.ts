import { ipcMain, BrowserWindow } from 'electron';
import { buildCachePrefix, buildMessages } from '../agent/cache';
import type { ContentPart } from '../agent/types';
import { getToolsForMode, getToolSchemas } from '../agent/tools';
import type { MultiAgentRole } from '../agent/tools/index';
import { buildProjectContext, loadProjectRules } from '../agent/context';
import { SubAgentManager } from '../agent/sub-agent';
import { getSystemPrompt, AgentMode } from '../agent/prompt';
import { resolveVisionConfig } from '../agent/vision-config';
import { enrichMessageWithVisionDescriptions } from '../agent/image-preprocess';
import { infoLog } from '../logger';
import { compressToolResult } from '../agent/compression';
import { buildExploreState, detectExploreMode, shouldContinueExplore, buildExploreNudge, buildExploreCompletionNudge } from '../agent/explore-monitor';
import { pluginManager } from '../plugin/manager';
import { runStreamChat } from './agent-stream';
import { executeToolCalls, cleanupFileWatchers, ToolContext } from './agent-tools';

const sessionAborts = new Map<string, AbortController>();
const sessionSubAgents = new Map<string, SubAgentManager>();

function estimateTokens(str: string): number {
  return Math.max(1, Math.ceil(str.length / 4));
}

/** 构建 system prompt 的各个组成部分，返回拆分后的结构以便缓存优化 */
function buildSystemPromptParts(
  mode: AgentMode | undefined,
  commandPrompt: string | undefined,
  multiAgentRoles: MultiAgentRole[],
  isMultiAgent: boolean,
  isCharacterMode: boolean,
): { base: string; roles: string; plugins: string; command: string } {
  const base = getSystemPrompt(mode);
  const plugins = isCharacterMode ? '' : pluginManager.getSystemPrompts();

  let roles = '';
  if (isMultiAgent && multiAgentRoles.length > 0) {
    roles = `## 可分派的角色（用于 spawn_role_agents 的 role_id）\n${multiAgentRoles.map(r => `- role_id: \`${r.id}\` ｜ 名称: ${r.name}${r.description ? ` ｜ 职责: ${r.description}` : ''}`).join('\n')}`;
  } else if (isMultiAgent) {
    roles = '## 角色清单\n当前没有配置任何角色，请提示用户前往「系统设置 → Multi-Agent 角色」中创建后再分派任务。';
  }

  return { base, roles, plugins, command: commandPrompt || '' };
}

/** 持续压缩早期工具调用结果，释放前缀空间提升缓存命中率 */
function compressContextIfNeeded(
  win: BrowserWindow,
  sessionId: string,
  messages: any[],
  currentPrompt: number,
  contextMax: number,
): void {
  // 降低触发门槛：50% 就开始压缩（之前 80% 太晚，缓存已严重碎片化）
  if (currentPrompt <= contextMax * 0.5) return;

  const toolIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') toolIndices.push(i);
  }

  // 保留最近 6 个工具结果（2 轮 × 3 次工具调用），其余全部压缩
  const keepRecent = 6;
  const compressTargets = toolIndices.slice(0, -keepRecent);
  let compressed = 0;
  for (const idx of compressTargets) {
    if (typeof messages[idx].content === 'string' && messages[idx].content.length > 120) {
      messages[idx].content = compressToolResult(messages[idx].content);
      compressed++;
    }
  }

  if (compressed > 0) {
    win.webContents.send('agent:stream-chunk', {
      sessionId, type: 'content',
      text: `\n[已压缩 ${compressed} 个早期工具结果以提升缓存命中率]\n`,
    });
  }
}

/** 空响应处理 + 探索模式判断 */
function handleEmptyResponse(
  win: BrowserWindow,
  sessionId: string,
  result: { content?: string; thinking?: string; finishReason?: string },
  messages: any[],
  turn: number,
  maxTurns: number,
  mode: AgentMode | undefined,
  projectDir: string,
): { shouldContinue: boolean; agentFailed: boolean; agentError?: string } {
  // 保存 assistant 消息
  if (result.content || result.thinking) {
    const msg: any = { role: 'assistant', content: result.content || '' };
    if (result.thinking) msg.reasoning_content = result.thinking;
    messages.push(msg);
  }

  // 空响应：无 tool_calls
  if (!result.content) {
    if (result.finishReason === 'length') {
      const hint = result.thinking
        ? '模型在思考阶段就用完了 token 配额，没有生成正文。建议：拆分任务、缩减上下文，或换用更大输出预算的模型。'
        : '模型输出被 max_tokens 截断且无内容。建议增加输出预算或简化提问。';
      win.webContents.send('agent:stream-chunk', { sessionId, type: 'error', message: hint });
      return { shouldContinue: false, agentFailed: true, agentError: hint };
    }
    if (!result.thinking) {
      const msg = `模型返回空响应（finish_reason=${result.finishReason ?? '未知'}）。可能是上游临时故障，请重试。`;
      win.webContents.send('agent:stream-chunk', { sessionId, type: 'error', message: msg });
      return { shouldContinue: false, agentFailed: true, agentError: msg };
    }
    // 只有 thinking 没 content
    win.webContents.send('agent:stream-chunk', {
      sessionId, type: 'content',
      text: `\n[模型仅输出了思考过程，未生成正文。以下为思考内容摘要]\n${result.thinking.slice(0, 2000)}${result.thinking.length > 2000 ? '\n...(已截断)' : ''}\n`,
    });
  }

  // 探索模式判断
  if (mode !== 'roleplay' && detectExploreMode(messages, result.content || '')) {
    const state = buildExploreState(messages, projectDir);
    win.webContents.send('agent:stream-chunk', {
      sessionId, type: 'explore-progress',
      readPercentage: state.readPercentage, readFileCount: state.uniqueReadCount,
      totalFiles: state.totalFiles, step: turn + 1, total: maxTurns,
    });

    if (shouldContinueExplore(state)) {
      messages.push({ role: 'user', content: buildExploreNudge(state, turn, maxTurns) });
      return { shouldContinue: true, agentFailed: false };
    }

    if (state.readPercentage >= 80 && (!result.content || result.content.length < 100)) {
      messages.push({ role: 'user', content: buildExploreCompletionNudge(state) });
      return { shouldContinue: true, agentFailed: false };
    }

    if (turn >= maxTurns - 1 && state.readPercentage < 80) {
      win.webContents.send('agent:stream-chunk', {
        sessionId, type: 'explore-warning',
        warning: `已达到最大轮次限制（${maxTurns}轮），已读取 ${state.readPercentage}% 的文件（${state.uniqueReadCount}/${state.totalFiles}）`,
      });
    }
  }

  return { shouldContinue: false, agentFailed: false };
}

export function setupAgentHandlers() {
  ipcMain.handle('agent:send', async (event, payload: {
    messages: Array<{ role: string; content: string; reasoning_content?: string; tool_calls?: any[] }>;
    apiKey: string;
    projectDir: string;
    newMessage: string | ContentPart[];
    model?: string;
    baseUrl?: string;
    contextMax?: number;
    commandPrompt?: string;
    mode?: AgentMode;
    providerMultimodal?: boolean;
    roles?: MultiAgentRole[];
    sessionId?: string;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window');

    const { sessionId = 'default' } = payload;

    // 同 session 已有运行中请求 → 取消旧的
    const oldAbort = sessionAborts.get(sessionId);
    if (oldAbort) {
      oldAbort.abort();
      sessionAborts.delete(sessionId);
      sessionSubAgents.get(sessionId)?.cancelAllSubAgents();
      sessionSubAgents.delete(sessionId);
    }

    const abortController = new AbortController();
    sessionAborts.set(sessionId, abortController);

    infoLog('agent', 'send-start', { sessionId, model: payload.model, mode: payload.mode, msgCount: payload.messages.length });

    try {
      // === 准备阶段 ===
      const isCharacterMode = payload.mode === 'roleplay';
      const isMultiAgent = payload.mode === 'multi-agent';
      const multiAgentRoles = isMultiAgent ? (payload.roles ?? []) : [];
      const projectContext = isCharacterMode ? '' : buildProjectContext(payload.projectDir);
      const projectRules = isCharacterMode ? '' : loadProjectRules(payload.projectDir);

      const subAgentManager = new SubAgentManager(win);
      sessionSubAgents.set(sessionId, subAgentManager);

      const tools = getToolsForMode(payload.mode, payload.projectDir);
      const promptParts = buildSystemPromptParts(payload.mode, payload.commandPrompt, multiAgentRoles, isMultiAgent, isCharacterMode);
      const prefix = buildCachePrefix(promptParts, projectContext, projectRules);

      const modelConfig = { model: payload.model || 'deepseek-v4-flash', baseUrl: payload.baseUrl ?? 'https://api.deepseek.com' };
      const visionConfig = resolveVisionConfig(modelConfig, payload.apiKey, { providerMultimodal: payload.providerMultimodal });

      let processedNewMessage: string | ContentPart[] = payload.newMessage;
      if (!payload.providerMultimodal && !Array.isArray(payload.newMessage) && visionConfig) {
        if (abortController.signal.aborted) {
          cleanupSession(sessionId);
          return { success: false, error: '已取消' };
        }
        processedNewMessage = await enrichMessageWithVisionDescriptions(payload.newMessage, visionConfig, abortController.signal);
      }

      const messages: any[] = buildMessages(prefix, payload.messages, processedNewMessage);
      infoLog('agent', 'messages-built', { msgCount: messages.length, sysPromptLen: prefix.parts.base.length });

      const enableTools = payload.mode !== 'roleplay';
      const toolSchemas = getToolSchemas(tools);

      let totalPrompt = 0, totalCompletion = 0, totalTokens = 0, totalToolTokens = 0;
      let totalCacheHit = 0, totalCacheMiss = 0;
      const maxTurns = enableTools ? 50 : 1;
      let agentFailed = false, agentError: string | undefined;

      // === 主循环 ===
      for (let turn = 0; turn < maxTurns; turn++) {
        if (abortController.signal.aborted) break;

        // API 调用（含重试和流式缓冲）
        let result;
        try {
          result = await runStreamChat(
            win, sessionId, payload.apiKey, messages, toolSchemas, modelConfig,
            abortController.signal, turn + 1, maxTurns,
          );
        } catch (err: any) {
          if (abortController.signal.aborted) break;
          const msg = err?.message || String(err);
          win.webContents.send('agent:stream-chunk', { sessionId, type: 'error', message: msg });
          win.webContents.send('agent:stream-chunk', { sessionId, type: 'done' });
          cleanupSession(sessionId);
          return { success: false, error: msg };
        }

        if (abortController.signal.aborted) break;

        // Token 统计 + 上下文压缩
        if (result.usage) {
          totalPrompt += result.usage.prompt_tokens;
          totalCompletion += result.usage.completion_tokens;
          totalTokens += result.usage.total_tokens;
          totalCacheHit += result.usage.prompt_cache_hit_tokens ?? 0;
          totalCacheMiss += result.usage.prompt_cache_miss_tokens ?? 0;
          win.webContents.send('agent:stream-chunk', {
            sessionId, type: 'usage',
            prompt: totalPrompt, completion: totalCompletion, total: totalTokens,
            toolTokens: totalToolTokens, currentPrompt: result.usage.prompt_tokens,
            contextMax: payload.contextMax || 100000,
            promptCacheHit: totalCacheHit || undefined,
            promptCacheMiss: totalCacheMiss || undefined,
            modelName: payload.model || 'deepseek-v4-flash',
          });
          compressContextIfNeeded(win, sessionId, messages, result.usage.prompt_tokens, payload.contextMax || 100000);
        }

        // 无工具调用 → 最终回复
        if (result.toolCalls.length === 0) {
          const { shouldContinue, agentFailed: failed, agentError: err } = handleEmptyResponse(
            win, sessionId, result, messages, turn, maxTurns, payload.mode, payload.projectDir,
          );
          if (failed) { agentFailed = true; agentError = err; break; }
          if (shouldContinue) continue;
          break;
        }

        // 有工具调用 → 执行
        const assistantToolCalls = result.toolCalls.map(tc => ({
          id: tc.id, type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
        const toolMsg: any = { role: 'assistant', content: result.content || '', tool_calls: assistantToolCalls };
        if (result.thinking) toolMsg.reasoning_content = result.thinking;
        messages.push(toolMsg);

        const ctx: ToolContext = {
          apiKey: payload.apiKey,
          modelConfig,
          contextMax: payload.contextMax || 100000,
          subAgentManager,
          signal: abortController.signal,
          projectDir: payload.projectDir,
          imageModelConfig: null, // 延迟解析
          visionModelConfig: null,
          multiAgentRoles,
        };

        const { toolMessages, totalToolTokens: toolTokens } = await executeToolCalls(
          win, sessionId, event, tools,
          result.toolCalls.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
          ctx, abortController, turn + 1, maxTurns,
        );
        totalToolTokens += toolTokens;
        messages.push(...toolMessages);
      }

      // === 清理 ===
      cleanupSession(sessionId);
      cleanupFileWatchers();
      win.webContents.send('agent:stream-chunk', { sessionId, type: 'done' });
      if (agentFailed) return { success: false, error: agentError || 'Agent 执行失败' };
      return { success: true };

    } catch (err: any) {
      const message = err?.message || String(err);
      win.webContents.send('agent:stream-chunk', { sessionId, type: 'error', message });
      win.webContents.send('agent:stream-chunk', { sessionId, type: 'done' });
      cleanupSession(sessionId);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('agent:cancel', async (_event, sessionId?: string) => {
    const id = sessionId || 'default';
    sessionAborts.get(id)?.abort();
    cleanupSession(id);
    return { success: true };
  });
}

function cleanupSession(sessionId: string) {
  sessionAborts.delete(sessionId);
  sessionSubAgents.get(sessionId)?.cancelAllSubAgents();
  sessionSubAgents.delete(sessionId);
}
