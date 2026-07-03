import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useFilesStore } from '../../stores/files';
import { useModelStore } from '../../stores/model';
import { useChatStore } from '../../stores/chat';
import { useConversationStore } from '../../stores/conversationStore';
import ModelSettings from '../settings/ModelSettings';
import PluginManager from '../plugins/PluginManager';
import { usePluginStore } from '../../stores/plugin';
import { useRefsStore } from '../../stores/refs';
import { useModeStore, MODES, AgentMode } from '../../stores/mode';
import { useRoleplayStore } from '../../stores/roleplay';
import { useAgentRolesStore } from '../../stores/agentRoles';
import { getCharactersByIds, resolveSessionCast } from '../../utils/roleplay-multi';
import { COMMANDS, matchCommand, getCommandList, Command } from '../../commands';
import Dropdown, { DropdownItem, useDropdownNav, useFocusedItemRef } from './Dropdown';
import shared from '../../styles/components.module.css';
import styles from './ChatInput.module.css';

export interface PastedImage {
  id: string;
  previewUrl: string;  // blob URL 用于缩略图（体积小，发送后释放）
  path: string;        // 磁盘文件路径（saveClipboardImage 失败时为空）
  mimeType: string;
}

interface Props {
  onSend: (message: string, command?: Command, images?: PastedImage[]) => void;
  disabled: boolean;
  isStreaming: boolean;
  onStop: () => void;
}

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 180;

export default function ChatInput({ onSend, disabled, isStreaming, onStop }: Props) {
  const [value, setValue] = useState('');
  const [atMaxHeight, setAtMaxHeight] = useState(false);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [images, setImages] = useState<PastedImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { openTabs } = useFilesStore();
  const activeConv = useConversationStore(s => s.conversations.find(c => c.id === s.activeId));
  const isGroup = activeConv?.type === 'group_npc' || activeConv?.type === 'group_agent';
  const groupMembers = isGroup ? (activeConv?.members || []) : [];
  const inMention = value.includes('@') && !value.includes(' ');
  const showMemberMention = inMention && isGroup && groupMembers.length > 0;
  const showFileMention = inMention && !isGroup && openTabs.length > 0;
  const { models, activeModelId, setActiveModel } = useModelStore();
  const { createSession, setSessionCharacter, setSessionCast: bindSessionCast } = useChatStore();
  const setActiveCharacter = useRoleplayStore(s => s.setActiveCharacter);
  const activeCharacterId = useRoleplayStore(s => s.activeCharacterId);
  const draftParticipantIds = useRoleplayStore(s => s.draftParticipantIds);
  const toggleDraftParticipant = useRoleplayStore(s => s.toggleDraftParticipant);
  const setSessionCastRoleplay = useRoleplayStore(s => s.setSessionCast);
  const { installedPlugins, loadInstalled } = usePluginStore();
  const refs = useRefsStore();

  const activeModel = models.find(m => m.id === activeModelId) ?? models[0];
  const { mode, setMode } = useModeStore();
  const activeMode = MODES.find(m => m.id === mode) ?? MODES[0];
  const activeCharacter = useRoleplayStore(s => s.getActiveCharacter());
  const activeSession = useChatStore(s => s.sessions.find(sess => sess.id === s.activeSessionId));
  const sessionCast = useMemo(() => resolveSessionCast(activeSession), [activeSession]);
  const characters = useRoleplayStore(s => s.characters);
  const sessionCharacters = useMemo(
    () => getCharactersByIds(characters, sessionCast.participantIds),
    [characters, sessionCast.participantIds],
  );
  const npcNames = sessionCharacters.map(c => c.name);
  const agentRoles = useAgentRolesStore(s => s.roles);

  useEffect(() => { loadInstalled(); }, []);
  useEffect(() => {
    if (mode === 'roleplay') void useRoleplayStore.getState().loadAll();
    if (mode === 'multi-agent') void useAgentRolesStore.getState().loadRoles();
  }, [mode]);

  const selectCharacter = useCallback(async (charId: string) => {
    setMode('roleplay');
    await setActiveCharacter(charId);
    if (!useChatStore.getState().activeSessionId) createSession();
    setSessionCharacter(charId, { sessionMode: 'roleplay', pendingOpening: true });
    setShowModeSelect(false);
  }, [setMode, setActiveCharacter, createSession, setSessionCharacter]);

  const startGroupChat = useCallback(async () => {
    const ids = useRoleplayStore.getState().draftParticipantIds;
    if (ids.length < 2) return;
    setMode('roleplay');
    await setSessionCastRoleplay(ids);
    if (!useChatStore.getState().activeSessionId) {
      createSession();
    } else {
      bindSessionCast(ids);
    }
    setShowModeSelect(false);
  }, [setMode, setSessionCastRoleplay, createSession, bindSessionCast]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      focusInput();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, focusInput]);

  const pluginCommands: Command[] = useMemo(() =>
    installedPlugins.map(p => ({
      name: p.name,
      description: p.description || '',
      detail: `已安装插件: ${p.name}`,
      systemPrompt: p.system_prompt,
    })), [installedPlugins]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const prevH = el.clientHeight;
    el.style.height = 'auto';
    const needed = el.scrollHeight;
    let newH = prevH;
    if (needed > prevH + 2) {
      newH = Math.min(needed, MAX_HEIGHT);
    } else if (needed < prevH - 24) {
      newH = Math.max(needed, MIN_HEIGHT);
    }
    el.style.height = `${newH}px`;
    setAtMaxHeight(newH >= MAX_HEIGHT - 2);
  }, [value]);

  const activeCommand = useMemo(() => matchCommand(value, pluginCommands), [value, pluginCommands]);
  const showCommandPalette = value.startsWith('/') && !value.includes(' ') && value.length >= 1;
  const filteredCommands = useMemo(() => {
    if (!showCommandPalette) return [];
    const query = value.slice(1).toLowerCase();
    const allCommands = [...COMMANDS, ...pluginCommands];
    if (!query) return allCommands;
    return allCommands.filter(c => c.name.includes(query));
  }, [value, showCommandPalette, pluginCommands]);

  const cmdFocusIdx = useDropdownNav(filteredCommands.length, (i) => selectCommand(filteredCommands[i]), () => {}, showCommandPalette && filteredCommands.length > 0);
  const mentionFocusIdx = useDropdownNav(openTabs.length, (i) => insertMention(openTabs[i].path), () => {}, showFileMention);
  const memberFocusIdx = useDropdownNav(groupMembers.length, (i) => insertMemberMention(groupMembers[i].name), () => {}, showMemberMention);

  const hasDropdownOpen = showCommandPalette || showFileMention || showMemberMention || showModelSelect || showModeSelect;

  const removeImage = useCallback((id: string) => {
    setImages(prev => {
      const removed = prev.find(img => img.id === id);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter(img => img.id !== id);
    });
  }, []);

  const pendingImagesRef = useRef(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const id = `img-${Date.now()}-${i}`;
        const mimeType = item.type;
        const previewUrl = URL.createObjectURL(blob);  // 缩略图用 blob URL
        pendingImagesRef.current++;
        void (async () => {
          try {
            const buf = await blob.arrayBuffer();
            const filePath = await window.api.files.saveClipboardImage(new Uint8Array(buf), mimeType);
            setImages(prev => [...prev, { id, previewUrl, path: filePath, mimeType }]);
            // 不在这里 revoke：缩略图还需要显示。clearImages/removeImage 时统一清理
          } catch (err) {
            console.error('saveClipboardImage failed:', err);
            setImages(prev => [...prev, { id, previewUrl, path: '', mimeType }]);
          }
          pendingImagesRef.current--;
        })();
      }
    }
  }, []);

  const clearImages = useCallback(() => {
    for (const img of imagesRef.current) {
      if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
    }
    setImages([]);
  }, []);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (hasDropdownOpen && (e.key === 'Enter' || e.key === 'Escape')) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return;
      const trimmed = value.trim();
      if (trimmed.startsWith('/browse')) {
        const url = trimmed.slice(7).trim();
        window.api.browser.open(url || undefined);
        setValue('');
        return;
      }
      if (trimmed === '/plugin') {
        setShowPluginManager(true);
        setValue('');
        return;
      }
      if (trimmed === '/new' || trimmed === '/clear') {
        createSession();
        setValue('');
        clearImages();
        focusInput();
        return;
      }
      if (trimmed || images.length > 0 || pendingImagesRef.current > 0) {
        await sendMessage();
      }
    }
    if (e.key === 'Escape') {
      if (isStreaming) { onStop(); return; }
      setShowModelSelect(false); setShowModeSelect(false);
    }
  }, [value, onSend, isStreaming, onStop, hasDropdownOpen, images, clearImages, focusInput, createSession]);

  const selectCommand = (cmd: Command) => {
    setValue('/' + cmd.name + ' ');
    textareaRef.current?.focus();
  };

  const insertMention = (path: string) => {
    setValue(v => v.slice(0, v.lastIndexOf('@')).trimEnd());
    refs.addRefFile(path);
    textareaRef.current?.focus();
  };

  const insertMemberMention = (name: string) => {
    setValue(v => {
      const idx = v.lastIndexOf('@');
      if (idx < 0) return v;
      return v.slice(0, idx) + '@' + name + ' ' + v.slice(idx + 1).replace(/^\S*\s?/, '');
    });
    textareaRef.current?.focus();
  };

  const sendMessage = async () => {
    if (isStreaming) return;
    const trimmed = value.trim();
    if (trimmed.startsWith('/browse')) {
      const url = trimmed.slice(7).trim();
      window.api.browser.open(url || undefined);
      setValue('');
      return;
    }
    if (trimmed === '/plugin') {
      setShowPluginManager(true);
      setValue('');
      return;
    }
    if (trimmed === '/new' || trimmed === '/clear') {
      createSession();
      setValue('');
      clearImages();
      focusInput();
      return;
    }
    if (trimmed || images.length > 0 || pendingImagesRef.current > 0) {
      // 等待粘贴的图片完成异步保存（FileReader + IPC）
      while (pendingImagesRef.current > 0) {
        await new Promise(r => setTimeout(r, 50));
      }
      const latestImages = imagesRef.current;
      const cmd = matchCommand(trimmed, pluginCommands);
      const msg = cmd ? trimmed.slice(cmd.name.length + 1).trim() : trimmed;
      const prefix = refs.refFiles.map(p => `@${p} `).join('');
      const suffix = refs.textRefs.length > 0 ? '\n\n---\n引用消息：\n' + refs.textRefs.join('\n---\n') : '';
      onSend(prefix + (msg || trimmed || (latestImages.length > 0 ? '请描述这张图片' : '')) + suffix, cmd || undefined, latestImages.length > 0 ? latestImages : undefined);
      setValue('');
      refs.clearRefs();
      clearImages();
      setAtMaxHeight(false);
      if (textareaRef.current) textareaRef.current.style.height = `${MIN_HEIGHT}px`;
      focusInput();
    }
  };

  const handleSend = () => { void sendMessage(); };

  return (
    <>
    <div
      className={styles.container}
      onClick={(e) => {
        if (showModelSettings || showPluginManager) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, select, textarea, [role="button"]')) return;
        textareaRef.current?.focus();
      }}
    >
      {/* Command palette */}
      {showCommandPalette && filteredCommands.length > 0 && (
        <Dropdown maxHeight={260}>
          <div className={styles.paletteHeading}>命令</div>
          {filteredCommands.map((cmd, i) => (
            <DropdownItem key={cmd.name} onClick={() => selectCommand(cmd)} focused={cmdFocusIdx === i}>
              <span className={styles.cmdChip}>/{cmd.name}</span>
              <span className={styles.cmdDesc}>{cmd.description}</span>
            </DropdownItem>
          ))}
        </Dropdown>
      )}

      {/* Active command indicator */}
      {activeCommand && (
        <div className={styles.cmdHint}>
          <span className={styles.cmdBadge}>/{activeCommand.name}</span>
          <span className={styles.cmdDetail}>{activeCommand.detail}</span>
        </div>
      )}

      {/* @ mention popup — 群成员 */}
      {showMemberMention && (
        <div className={shared.mentionPopup}>
          {groupMembers.map((m, i) => (
            <MentionItem
              key={m.roleId}
              focused={memberFocusIdx === i}
              onClick={() => insertMemberMention(m.name)}
            >
              <span className={shared.mentionIcon}>💬</span>
              <span className={shared.mentionName}>{m.name}</span>
              <span className={shared.mentionDetail}>{m.roleType === 'agent' ? 'Agent' : 'NPC'}</span>
            </MentionItem>
          ))}
        </div>
      )}

      {/* @ mention popup — 文件 */}
      {showFileMention && (
        <div className={shared.mentionPopup}>
          {openTabs.map((t, i) => (
            <MentionItem
              key={t.path}
              focused={mentionFocusIdx === i}
              onClick={() => insertMention(t.path)}
            >
              {t.name}
            </MentionItem>
          ))}
        </div>
      )}

      {/* Text reference chips */}
      {refs.textRefs.length > 0 && (
        <div className={shared.chipBar}>
          {refs.textRefs.map((text, i) => {
            const label = text.length > 40 ? text.slice(0, 40) + '...' : text;
            return (
              <div key={i} className={`${shared.chip} ${shared.chipText}`}>
                <span className={styles.chipLabel}>{label}</span>
                <span className={shared.chipClose} onClick={() => refs.removeTextRef(text)} title="取消引用">✕</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Referenced files chips */}
      {refs.refFiles.length > 0 && (
        <div className={shared.chipBar}>
          {refs.refFiles.map((path, i) => {
            const name = path.split(/[\\/]/).pop() || path;
            return (
              <div key={i} className={`${shared.chip} ${shared.chipFile}`}>
                <span className={styles.fileChipLabel}>{name}</span>
                <span className={shared.chipClose} onClick={() => refs.removeRefFile(path)} title="取消引用">✕</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pasted image thumbnails */}
      {images.length > 0 && (
        <div className={styles.imageStrip}>
          {images.map(img => (
            <div key={img.id} className={styles.imageChip}>
              <img src={img.previewUrl} alt="" className={styles.imageThumb} />
              <span className={styles.imageRemove} onClick={() => removeImage(img.id)} title="移除图片">✕</span>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className={`${shared.inputWrapper} ${activeCommand ? shared.inputWrapperActive : ''}`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          data-chat-input="true"
          placeholder={disabled ? 'AI 正在回复，可先输入下一条…' : 'Ask Oh My DeepSeek... (/ commands · @ files)'}
          spellCheck={false}
          className={shared.textarea}
          style={{
            minHeight: MIN_HEIGHT,
            maxHeight: MAX_HEIGHT,
            overflow: atMaxHeight ? 'auto' : 'hidden',
          }}
        />

        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {/* Model dropdown */}
            <div className={styles.modelTrigger}>
              <button
                onClick={() => setShowModelSelect(!showModelSelect)}
                className={`${styles.modelBtn} ${shared.hoverSubtle}`}
              >
                <span>{activeModel?.name || 'Agent'}</span>
                <span className={styles.dropdownCaret}>▼</span>
              </button>

              {showModelSelect && (
                <Dropdown minWidth={200}>
                  {models.map(m => (
                    <DropdownItem key={m.id} active={m.id === activeModelId} onClick={() => { setActiveModel(m.id); setShowModelSelect(false); }}>
                      <div className={styles.itemName}>{m.name}</div>
                      <div className={styles.itemMeta}>{m.model}</div>
                    </DropdownItem>
                  ))}
                  <DropdownItem onClick={() => { setShowModelSelect(false); setShowModelSettings(true); }}>
                    <span className={styles.itemSub}>管理模型...</span>
                  </DropdownItem>
                </Dropdown>
              )}
            </div>

            <ToolbarBtn title="新建会话" onClick={() => createSession()}>
              <img src="./assets/13.png" alt="new" className={styles.toolbarIcon} />
            </ToolbarBtn>

            {/* Mode / Character selector */}
            <div className={styles.modelTrigger}>
              <button
                onClick={() => setShowModeSelect(!showModeSelect)}
                title={mode === 'roleplay' ? '选择扮演角色' : activeMode.description}
                className={`${styles.modelBtn} ${shared.hoverSubtle}`}
              >
                <img src={mode === 'roleplay' ? './assets/role.png' : activeMode.icon} alt="" className={styles.toolbarIcon} style={{ opacity: 1 }} />
                <span>{mode === 'roleplay'
                  ? (sessionCast.isMulti ? `群聊 ${sessionCast.participantIds.length} 人` : (activeCharacter?.name ?? '选择角色'))
                  : activeMode.label}</span>
                <span className={styles.dropdownCaret}>▼</span>
              </button>

              {showModeSelect && (
                <Dropdown minWidth={180}>
                  {mode === 'roleplay' ? (
                    characters.length > 0 ? (
                      <>
                        {characters.map(c => {
                          const inDraft = draftParticipantIds.includes(c.id);
                          const isActiveSingle = c.id === activeCharacterId && draftParticipantIds.length <= 1;
                          return (
                            <DropdownItem key={c.id} active={isActiveSingle} onClick={() => void selectCharacter(c.id)}>
                              <div className={styles.modeRow}>
                                <span
                                  onClick={(e) => { e.stopPropagation(); toggleDraftParticipant(c.id); }}
                                  title="勾选以加入群聊"
                                  style={{ display: 'flex', alignItems: 'center' }}
                                >
                                  <input type="checkbox" checked={inDraft} onChange={() => { /* handled by span onClick */ }} />
                                </span>
                                <img src="./assets/role.png" alt="" className={styles.modeIcon} />
                                <div>
                                  <div className={styles.modeName}>{c.name}</div>
                                  <div className={styles.modeDesc}>{c.background?.trim().slice(0, 24) || '点选 1v1，勾选加入群聊'}</div>
                                </div>
                              </div>
                            </DropdownItem>
                          );
                        })}
                        {draftParticipantIds.length >= 2 && (
                          <DropdownItem onClick={() => void startGroupChat()}>
                            <span className={styles.itemSub}>开始群聊（{draftParticipantIds.length} 人）</span>
                          </DropdownItem>
                        )}
                      </>
                    ) : (
                      <DropdownItem onClick={() => setShowModeSelect(false)}>
                        <span className={styles.itemSub}>暂无角色，请在「角色管理」中创建</span>
                      </DropdownItem>
                    )
                  ) : (
                    MODES.filter(m => m.id !== 'roleplay').map(m => (
                      <DropdownItem key={m.id} active={m.id === mode} onClick={() => { setMode(m.id as AgentMode); setShowModeSelect(false); }}>
                        <div className={styles.modeRow}>
                          <img src={m.icon} alt="" className={styles.modeIcon} />
                          <div>
                            <div className={styles.modeName}>{m.label}</div>
                            <div className={styles.modeDesc}>{m.description}</div>
                          </div>
                        </div>
                      </DropdownItem>
                    ))
                  )}
                </Dropdown>
              )}
            </div>

            {mode === 'roleplay' && sessionCast.isMulti && (
              <span className={styles.characterChip} title="群像角色扮演">
                群聊 · 你本人 · NPC: {npcNames.join('、') || '—'}
              </span>
            )}
            {mode === 'multi-agent' && (
              <span
                className={styles.characterChip}
                title={agentRoles.length > 0 ? agentRoles.map(r => r.name).join('、') : '前往 系统设置 → Multi-Agent 角色 配置'}
              >
                {agentRoles.length > 0 ? `角色 ${agentRoles.length} 个` : '未配置角色'}
              </span>
            )}
          </div>

          <div className={styles.toolbarRight}>
            {isStreaming ? (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={onStop}
                title="停止生成 (Esc)"
                className={styles.stopBtn}
              >
                <img src="./assets/stop.png" alt="stop" className={styles.stopIcon} />
              </button>
            ) : (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSend}
                disabled={disabled || (!value.trim() && images.length === 0 && pendingImagesRef.current === 0)}
                className={disabled || (!value.trim() && images.length === 0 && pendingImagesRef.current === 0) ? styles.sendBtnDisabled : styles.sendBtn}
              >
                <img src="./assets/9.png" alt="send" className={styles.sendIcon} />
              </button>
            )}
          </div>
        </div>
      </div>

    </div>

      {showModelSettings && <ModelSettings onClose={() => setShowModelSettings(false)} />}
      {showPluginManager && <PluginManager onClose={() => setShowPluginManager(false)} />}
    </>
  );
}

function ToolbarBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return <button onClick={onClick} title={title} className={shared.toolbarBtn}>{children}</button>;
}

function MentionItem({
  focused,
  onClick,
  children,
}: {
  focused: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useFocusedItemRef(focused);

  return (
    <div
      ref={ref}
      className={shared.mentionItem}
      onClick={onClick}
      style={{ background: focused ? 'var(--bg-tertiary)' : undefined }}
    >
      {children}
    </div>
  );
}
