import React, { useState, useCallback, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ToolCall } from '../../../common/conversation';
import { useChatStore, type RoleplayMessageMeta } from '../../stores/chat';
import { useRefsStore } from '../../stores/refs';
import { useModeStore } from '../../stores/mode';
import { useRoleplayStore } from '../../stores/roleplay';
import { parseRoleplayResponse, parseMultiRoleplayResponse, formatRoleplayMessageForHistory } from '../../utils/parseRoleplayResponse';
import { getEffectiveStatusFields, getTemplateById } from '../../utils/roleplay';
import { getCharactersByIds, mapTurnsToMeta, resolveSessionCast } from '../../utils/roleplay-multi';
import RoleplayStatusPanel from '../roleplay/RoleplayStatusPanel';
import ThinkingChain from './ThinkingChain';
import shared from '../../styles/components.module.css';
import styles from './MessageBubble.module.css';

interface Props {
  message: Message;
}

function TurnBlock({
  turn,
  fieldDefs,
  portraitPath,
}: {
  turn: import('../../stores/chat').RoleplayTurnMeta;
  fieldDefs: import('../../utils/roleplay').StatusFieldDef[];
  portraitPath?: string;
}) {
  return (
    <div className={styles.turnBlock}>
      <div className={styles.speakerName}>{turn.characterName}</div>
      <div className={`${styles.bubble} ${styles.bubbleAi}`}>
        <MessageContent content={turn.reply || '...'} />
      </div>
      {turn.status && fieldDefs.length > 0 && (
        <RoleplayStatusPanel
          status={turn.status}
          fieldDefs={fieldDefs}
          portraitPath={portraitPath}
          characterName={turn.characterName}
        />
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button onClick={handleCopy} className={shared.copyBtn} style={{ color: copied ? '#22c55e' : undefined }}>
      {copied ? '✓ 已复制' : '📋 复制链接'}
    </button>
  );
}

function isLocalImagePath(url: string): boolean {
  const trimmed = decodeURIComponent(url).trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  if (/^\/[A-Za-z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !/^\/[A-Za-z]:/.test(trimmed)) return true;
  if (trimmed.startsWith('file://')) return true;
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:') && /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

function normalizeLocalImagePath(url: string): string {
  let cleaned = url.trim();
  try { cleaned = decodeURIComponent(cleaned); } catch { /* keep as-is */ }
  if (/^file:\/\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^file:\/\/\//i, '');
  } else if (/^file:\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^file:\/\//i, '');
  } else if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith('data:')) {
    return cleaned; // 远程/内联 URL，原样返回
  }
  cleaned = cleaned.replace(/\\/g, '/');
  cleaned = cleaned.replace(/^\/([A-Za-z]:)\//, '$1/');
  return cleaned.replace(/\//g, '\\');
}

function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (isLocalImagePath(url)) return true;
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/.test(lower)) return true;
  if (lower.startsWith('data:image/')) return true;
  // 仅匹配已知生图 CDN 的域名，避免把普通链接误判成图片
  if (
    lower.includes('oaidalleapiprodscus.blob.core.windows.net') ||
    lower.includes('cdn.openai.com') ||
    lower.includes('files.oaiusercontent.com')
  ) return true;
  return false;
}

function ImageCard({ url, alt }: { url: string; alt: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const localPath = normalizeLocalImagePath(url);
  const isLocal = isLocalImagePath(localPath);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setError(null);

    if (isLocal) {
      window.api.files.readBinary(localPath)
        .then((dataUri) => {
          if (!cancelled) setResolved(dataUri);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '无法加载本地图片');
          }
        });
    } else {
      setResolved(url);
    }

    return () => { cancelled = true; };
  }, [url, localPath, isLocal]);

  if (isLocal && !resolved && !error) {
    return (
      <div className={styles.imageWrap}>
        <span className={styles.imageHint}>加载图片中...</span>
      </div>
    );
  }

  if (error || (isLocal && !resolved)) {
    return (
      <div className={styles.imageWrap}>
        <a href={localPath} target="_blank" rel="noopener noreferrer" className={styles.imageLink}>
          {alt || localPath}
        </a>
        <div style={{ marginTop: 4 }}>
          <CopyButton text={localPath} />
        </div>
        {error && <div className={styles.imageHint}>{error}</div>}
      </div>
    );
  }

  const src = resolved || url;

  return (
    <div className={styles.imageWrap}>
      <img
        src={src}
        alt={alt}
        className={styles.image}
        onClick={() => {
          if (isLocal) {
            window.api.files.showInExplorer(localPath);
          } else {
            window.open(url, '_blank');
          }
        }}
        onError={() => setError('图片加载失败')}
      />
      <div className={styles.imageMeta}>
        <CopyButton text={isLocal ? localPath : url} />
        <span className={styles.imageHint}>
          {isLocal ? '点击图片可在资源管理器中定位' : '点击图片可在新标签页打开'}
        </span>
      </div>
    </div>
  );
}
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src) return null;
  return <ImageCard url={src} alt={alt || ''} />;
}

class MarkdownErrorBoundary extends React.Component<{ content: string; children: React.ReactNode }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <div className={styles.textWrap}>{this.props.content}</div>;
    }
    return this.props.children;
  }
}

function MessageContent({ content }: { content: string }) {
  // 提取内嵌的 data:image 图片，从 markdown 内容中分离
  const imageUrls: string[] = [];
  let cleanContent = content;
  const dataImageRe = /!\[image\]\((data:image\/[^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = dataImageRe.exec(content)) !== null) {
    imageUrls.push(m[1]);
  }
  if (imageUrls.length > 0) {
    cleanContent = content.replace(dataImageRe, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 纯图片消息
  if (!cleanContent && imageUrls.length === 1) {
    return (
      <div>
        {imageUrls.map((url, i) => <ImageCard key={i} url={url} alt="" />)}
      </div>
    );
  }

  const trimmed = cleanContent.trim();
  if (!trimmed && imageUrls.length === 0) {
    if (isImageUrl(content.trim()) || content.trim().startsWith('data:image/')) {
      return <ImageCard url={content.trim()} alt="" />;
    }
  }

  return (
    <div className={styles.markdownBody}>
      {imageUrls.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {imageUrls.map((url, i) => <ImageCard key={i} url={url} alt="" />)}
        </div>
      )}
      {cleanContent && (
        <MarkdownErrorBoundary content={cleanContent}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ src, alt }) => <MarkdownImage src={src} alt={alt} />,
              a: ({ href, children }) => {
                const url = href || '';
                if (isImageUrl(url)) return <ImageCard url={url} alt={String(children ?? '')} />;
                return <a href={url} target="_blank" rel="noopener noreferrer" className={styles.link}>{children}</a>;
              },
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                if (isInline) {
                  return <code className={styles.inlineCode}>{children}</code>;
                }
                return (
                  <pre className={styles.codeBlock}>
                    <code className={className}>{children}</code>
                  </pre>
                );
              },
              p: ({ children }) => <p className={styles.paragraph}>{children}</p>,
              ul: ({ children }) => <ul className={styles.list}>{children}</ul>,
              ol: ({ children }) => <ol className={styles.list}>{children}</ol>,
              table: ({ children }) => (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>{children}</table>
                </div>
              ),
              blockquote: ({ children }) => <blockquote className={styles.blockquote}>{children}</blockquote>,
            }}
          >
            {cleanContent}
          </ReactMarkdown>
        </MarkdownErrorBoundary>
      )}
    </div>
  );
}

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tc.status === 'running';
  const isError = tc.status === 'error';

  const statusColor = isRunning ? 'var(--accent)' : isError ? '#ef4444' : '#22c55e';
  const bgColor = isRunning ? 'rgba(124,58,237,0.06)' : isError ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.04)';

  return (
    <div className={styles.toolCard} style={{ background: bgColor, border: `1px solid ${statusColor}20` }}>
      <div className={styles.toolHeader} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
        <span style={{ color: statusColor }}>{expanded ? '▼' : '▶'}</span>
        {isRunning ? (
          <span className={styles.spinner} style={{ borderColor: `${statusColor}40`, borderTopColor: statusColor }} />
        ) : isSuccess(tc) ? (
          <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3 8l3 3 7-7" stroke="#22c55e" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 1v10M4 6l4 4 4-4" stroke="#ef4444" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/><circle cx="8" cy="14" r="1" fill="#ef4444"/></svg>
        )}
        <span className={styles.toolName}>{tc.name}</span>
        {isRunning && <span className={styles.toolStatus} style={{ color: 'var(--text-secondary)' }}>执行中...</span>}
        {isSuccess(tc) && <span className={styles.toolStatus} style={{ color: '#22c55e' }}>完成</span>}
        {isError && <span className={styles.toolStatus} style={{ color: '#ef4444' }}>失败</span>}
      </div>
      {expanded && (
        <div className={styles.toolBody} style={{ borderTop: `1px solid ${statusColor}20` }}>
          <div className={styles.toolBodySection}>
            <div className={styles.toolLabel}>请求参数：</div>
            <pre className={`${styles.toolPre} ${styles.toolPreSm}`}>
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {tc.result && (
            <div>
              <div className={styles.toolLabel}>返回数据：</div>
              <pre className={`${styles.toolPre} ${styles.toolPreLg}`}>
                {tc.result.length > 2000 ? tc.result.slice(0, 2000) + '\n...[已截断]...' : tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function isSuccess(tc: ToolCall): boolean {
  return tc.status === 'success';
}

function ToolCallProgress({ toolCalls }: { toolCalls?: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  const running = toolCalls.filter(t => t.status === 'running').length;
  const done = toolCalls.filter(t => t.status === 'success').length;
  const failed = toolCalls.filter(t => t.status === 'error').length;
  const uniqueNames = [...new Set(toolCalls.map(t => t.name))];

  const statusIcon = running > 0 ? '⏳' : failed > 0 ? '⚠️' : '✅';
  const statusText = running > 0 ? '执行中' : failed > 0 ? `${failed} 个失败` : '已完成';
  const nameList = uniqueNames.slice(0, 3).join(', ') + (uniqueNames.length > 3 ? ` 等 ${uniqueNames.length} 个` : '');

  return (
    <div className={styles.toolSummary} onClick={() => setExpanded(!expanded)}>
      <span className={styles.toolSummaryIcon}>{statusIcon}</span>
      <span className={styles.toolSummaryText}>{statusText} · {done + running + failed} 个操作 · {nameList}</span>
      {toolCalls.length > 0 && (
        <span className={styles.toolSummaryToggle}>{expanded ? '收起 ▲' : '展开 ▼'}</span>
      )}
      {expanded && (
        <div className={styles.toolSummaryBody}>
          {toolCalls.map((tc, i) => <ToolCallCard key={i} tc={tc} />)}
        </div>
      )}
    </div>
  );
}

function UserActions({ message, visible }: { message: Message; visible: boolean }) {
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
  }, [message.content]);

  const fillTextarea = useCallback((text: string, focus: boolean) => {
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
    if (!textarea) return;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    nativeInputValueSetter?.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) textarea.focus();
  }, []);

  const handleResend = useCallback(() => {
    fillTextarea(message.content, false);
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }, 50);
  }, [message.content, fillTextarea]);

  const handleAddToContext = useCallback(() => {
    useRefsStore.getState().addTextRef(message.content);
  }, [message.content]);

  return (
    <div className={styles.actions} style={{ opacity: visible ? 1 : 0 }}>
      <ActionBtn onClick={handleCopy} title="复制">
        <img src="./assets/file.png" alt="复制" className={styles.actionIcon} />
      </ActionBtn>
      <ActionBtn onClick={handleResend} title="重新发送">
        <img src="./assets/refresh.png" alt="重新发送" className={styles.actionIcon} />
      </ActionBtn>
      <ActionBtn onClick={handleAddToContext} title="添加到对话">
        <img src="./assets/add.png" alt="添加到对话" className={styles.actionIcon} />
      </ActionBtn>
    </div>
  );
}

function ActionBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} className={shared.actionBtn}>{children}</button>;
}

function AssistantRoleplayDebug({ message, hasStatusPanel, expectedStatus }: {
  message: Message;
  hasStatusPanel: boolean;
  expectedStatus: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const rawBody = useMemo(() => {
    if (message.rawContent) return message.rawContent;
    const meta = message.roleplayMeta as RoleplayMessageMeta | undefined;
    if (meta?.status) {
      return formatRoleplayMessageForHistory(message.content, meta.status);
    }
    return message.content;
  }, [message.rawContent, message.content, message.roleplayMeta?.status]);

  const handleCopyRaw = useCallback(() => {
    void navigator.clipboard.writeText(rawBody);
  }, [rawBody]);

  const missingStatus = expectedStatus && !hasStatusPanel;

  return (
    <div className={styles.debugWrap}>
      {missingStatus && (
        <div className={styles.debugHint}>
          未检测到状态面板，可能是模型未输出 &lt;status&gt; 或 JSON 格式无效
        </div>
      )}
      <div className={styles.debugHeader}>
        <button
          type="button"
          className={styles.debugToggle}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '▼' : '▶'} 原始回复
        </button>
        <button type="button" className={styles.debugCopy} onClick={handleCopyRaw}>
          复制
        </button>
      </div>
      {expanded && (
        <pre className={styles.debugPre}>{rawBody || '（空）'}</pre>
      )}
    </div>
  );
}

const MessageBubble = React.memo(function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';
  const hasThinking = !isUser && !!message.thinkingContent;
  const hasContent = !!message.content;
  const showContentBubble = isUser || !hasThinking || hasContent;
  const [actionsVisible, setActionsVisible] = useState(false);
  const mode = useModeStore(s => s.mode);
  const activeSession = useChatStore(s => s.sessions.find(sess => sess.id === s.activeSessionId));
  const sessionCast = useMemo(() => resolveSessionCast(activeSession), [activeSession]);
  const characters = useRoleplayStore(s => s.characters);
  const sessionCharacters = useMemo(
    () => getCharactersByIds(characters, sessionCast.participantIds),
    [characters, sessionCast.participantIds],
  );
  const activeCharacter = useRoleplayStore(s => s.getActiveCharacter());
  const isRoleplayChat = mode === 'roleplay' && sessionCast.participantIds.length > 0;
  const isCharacterChat = isRoleplayChat;
  const isMultiRoleplay = sessionCast.isMulti;
  const templates = useRoleplayStore(s => s.templates);
  const primaryCharacter = sessionCharacters[0] ?? activeCharacter;
  const activeTemplate = useMemo(
    () => getTemplateById(templates, primaryCharacter?.templateId),
    [templates, primaryCharacter?.templateId],
  );
  const statusFieldDefs = useMemo(
    () => getEffectiveStatusFields(primaryCharacter, activeTemplate),
    [primaryCharacter, activeTemplate],
  );
  const [assistantAvatar, setAssistantAvatar] = useState('./assets/ai_avater.png');

  const displayContent = useMemo(() => {
    if (isUser) return message.content;
    if (mode === 'roleplay' && isRoleplayChat) {
      const raw = message.rawContent || message.content;
      if (/<turn\s+character=|<scene\s*>/i.test(raw)) {
        const parsed = parseMultiRoleplayResponse(raw);
        if (parsed.displayText) return parsed.displayText;
      }
      if (/<reply\s*>|<\/reply\s*>|<status\s*>/i.test(raw)) {
        const parsed = parseRoleplayResponse(raw);
        if (parsed.reply) return parsed.reply;
      }
    }
    return message.content;
  }, [isUser, message.content, message.rawContent, mode, isRoleplayChat]);

  const roleplayTurns = useMemo(() => {
    if (isUser || !isRoleplayChat || !isMultiRoleplay) return [];
    const meta = message.roleplayMeta as RoleplayMessageMeta | undefined;
    if (meta?.turns?.length) return meta.turns;
    const raw = message.rawContent || message.content;
    if (/<turn\s+character=|<scene\s*>/i.test(raw)) {
      const parsed = parseMultiRoleplayResponse(raw);
      if (parsed.turns.length > 0) {
        return mapTurnsToMeta(parsed.turns, sessionCharacters);
      }
    }
    return [];
  }, [isUser, isRoleplayChat, isMultiRoleplay, message.roleplayMeta, message.rawContent, message.content, sessionCharacters]);

  const roleplayStatus = useMemo(() => {
    if (isUser || !isRoleplayChat) return null;
    const meta = message.roleplayMeta as RoleplayMessageMeta | undefined;
    if (meta?.status) return meta.status;
    const raw = message.rawContent || message.content;
    if (raw.includes('<status>') || raw.includes('<reply>')) {
      const parsed = parseRoleplayResponse(raw);
      if (parsed.status) return parsed.status;
    }
    return null;
  }, [isUser, isRoleplayChat, message.content, message.rawContent, message.roleplayMeta]);

  useEffect(() => {
    if (isUser || !isCharacterChat || !primaryCharacter?.portraitPath) {
      setAssistantAvatar('./assets/ai_avater.png');
      return;
    }
    let cancelled = false;
    void window.api.files.readBinary(primaryCharacter.portraitPath).then(url => {
      if (!cancelled) setAssistantAvatar(url);
    }).catch(() => {
      if (!cancelled) setAssistantAvatar('./assets/ai_avater.png');
    });
    return () => { cancelled = true; };
  }, [isUser, isCharacterChat, primaryCharacter?.portraitPath]);

  const showSingleBubble = showContentBubble && roleplayTurns.length === 0;

  return (
    <div
      onMouseEnter={() => setActionsVisible(true)}
      onMouseLeave={() => setActionsVisible(false)}
      className={styles.wrapper}
      style={{ flexDirection: isUser ? 'row-reverse' : 'row' }}
    >
      <div className={`${styles.avatar} ${isUser ? styles.avatarUser : styles.avatarAi}`}>
        <img src={isUser ? './assets/head.png' : assistantAvatar} alt={isUser ? 'user' : 'ai'} className={styles.avatarImg} />
      </div>
      <div className={styles.contentWrap}>
        {hasThinking && (
          <ThinkingChain text={message.thinkingContent!} hasContent={hasContent} />
        )}

        <ToolCallProgress toolCalls={message.toolCalls} />

        {showSingleBubble && (
          <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAi}`}>
            <MessageContent content={displayContent || '...'} />
          </div>
        )}

        {!isUser && isRoleplayChat && roleplayTurns.length > 0 && roleplayTurns.map(turn => {
          const character = sessionCharacters.find(c => c.id === turn.characterId);
          const template = getTemplateById(templates, character?.templateId);
          const fieldDefs = getEffectiveStatusFields(character, template);
          return (
            <TurnBlock
              key={`${turn.characterId}-${turn.reply.slice(0, 24)}`}
              turn={turn}
              fieldDefs={fieldDefs}
              portraitPath={character?.portraitPath}
            />
          );
        })}

        {!isUser && isRoleplayChat && roleplayTurns.length === 0 && roleplayStatus && (
          <RoleplayStatusPanel
            status={roleplayStatus}
            fieldDefs={statusFieldDefs}
            portraitPath={primaryCharacter?.portraitPath}
          />
        )}

        {isUser && <UserActions message={message} visible={actionsVisible} />}
      </div>
    </div>
  );
});

export { MessageContent };
export default MessageBubble;
