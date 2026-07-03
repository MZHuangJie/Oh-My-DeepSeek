import React, { useEffect } from 'react';
import styles from './styles/components.module.css';
import Sidebar from './components/sidebar/Sidebar';
import ChatList from './components/sidebar/ChatList';

import GitPanel from './components/sidebar/GitPanel';
import ActivityBar, { PanelView, SystemMenuAction } from './components/sidebar/ActivityBar';
import BrowserView from './components/chat/BrowserView';
import ChatWorkspace from './components/chat/ChatWorkspace';
import AgentPanel from './components/agent/AgentPanel';
import EditorTabs from './components/editor/EditorTabs';
import CodeEditor from './components/editor/CodeEditor';
import DiffView from './components/editor/DiffView';
import ImageViewer, { isImageFile } from './components/editor/ImageViewer';
import TerminalPanel from './components/terminal/TerminalPanel';
import TerminalTabs from './components/terminal/TerminalTabs';
import TerminalList from './components/terminal/TerminalList';
import StatusBar from './components/statusbar/StatusBar';
import TimelinePanel from './components/chat/TimelinePanel';
import ModelSettings from './components/settings/ModelSettings';
import MultiAgentSettings from './components/settings/MultiAgentSettings';
import ThemeSettings from './components/settings/ThemeSettings';
import AboutDialog from './components/settings/AboutDialog';
import CharacterSettings from './components/settings/CharacterSettings';
import CharacterPickerPanel from './components/roleplay/CharacterPickerPanel';
import GitPassphraseDialog from './components/git/GitPassphraseDialog';
import QuickOpen from './components/chat/QuickOpen';
import { useFilesStore } from './stores/files';
import { useTerminalStore } from './stores/terminal';
import { useConversationStore } from './stores/conversationStore';
import { useLayoutStore, SIDEBAR_MIN_WIDTH } from './stores/layout';
import { useIconThemeStore } from './stores/iconTheme';
import { useThemeStore } from './stores/theme';
import { useBrowserStore } from './stores/browser';
import { useModeStore } from './stores/mode';
import AccountCenter from './components/account/AccountCenter';
import Toast from './components/Toast';
import Confirm from './components/Confirm';
import { useAuthStore } from './stores/auth';
import ResizeHandle from './components/layout/ResizeHandle';
import SidebarResizeHandle from './components/layout/SidebarResizeHandle';

export default function App() {
  const { activeTab, openTabs, updateTabContent, saveFile } = useFilesStore();
  const { activeTermId, createTerminal } = useTerminalStore();
  const {
    sidebarWidth, agentPanelWidth, terminalHeight, chatPanelWidth,
    bottomExpanded, bottomClosed, setBottomClosed, setBottomExpanded,
    setSidebarWidth, setAgentPanelWidth, setTerminalHeight, setChatPanelWidth,
  } = useLayoutStore();

  const activeFile = openTabs.find(t => t.path === activeTab);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const state = useFilesStore.getState();
        if (state.activeTab) state.saveFile(state.activeTab);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const [showModelSettings, setShowModelSettings] = React.useState(false);
  const [showThemeSettings, setShowThemeSettings] = React.useState(false);
  const [showAbout, setShowAbout] = React.useState(false);
  const [showCharacterSettings, setShowCharacterSettings] = React.useState(false);
  const [showAgentRoles, setShowAgentRoles] = React.useState(false);
  const [showQuickOpen, setShowQuickOpen] = React.useState(false);
  const [sidebarResizing, setSidebarResizing] = React.useState(false);
  const [askpassRequest, setAskpassRequest] = React.useState<{ id: string; prompt: string; keyPath: string } | null>(null);
  const [openView, setOpenView] = React.useState<PanelView | null>(null);
  const mode = useModeStore(s => s.mode);
  const setRoleplay = useModeStore(s => s.setRoleplay);
  const authUser = useAuthStore(s => s.user);
  const authRestore = useAuthStore(s => s.restore);
  const { url: browserUrl, open: browserOpen, setOpen: setBrowserOpen } = useBrowserStore();
  const [showAccountCenter, setShowAccountCenter] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  React.useEffect(() => { window.api.window.isMaximized().then(setMaximized); }, []);

  useEffect(() => {
    if (mode !== 'roleplay' && openView === 'roleplay') {
      setOpenView(null);
    }
  }, [mode, openView]);

  useEffect(() => {
    void authRestore();
  }, [authRestore]);

  useEffect(() => {
    useIconThemeStore.getState().loadThemes();
    useThemeStore.getState().loadTheme();
  }, []);
  const handleToggleView = (view: PanelView) => {
    if (view === 'browser') {
      setBrowserOpen(!browserOpen);
      if (!browserOpen) setOpenView(null);
    } else {
      setBrowserOpen(false);
      setOpenView(prev => prev === view ? null : view);
    }
  };

  // 监听工具调用的 browser:load-url
  useEffect(() => {
    const unsub = window.api.browser.onLoadUrl((url) => {
      setBrowserOpen(true);
      useBrowserStore.getState().setUrl(url);
    });
    return unsub;
  }, [setBrowserOpen]);

  // 同步 browser store 的 open 状态到面板
  React.useEffect(() => {
    if (browserOpen) setOpenView(null); // 关闭其他面板
  }, [browserOpen]);

  // 监听 present_web 传来的 URL，自动打开浏览器面板
  useEffect(() => {
    const unsubscribe = window.api.browser.onLoadUrl((url) => {
      setBrowserOpen(true);
      useBrowserStore.getState().setUrl(url);
    });
    return unsubscribe;
  }, [setBrowserOpen]);

  useEffect(() => {
    const unsub = window.api.git.onAskpassRequest(req => {
      setAskpassRequest(prev => prev ?? req);
    });
    return unsub;
  }, []);

  // 浏览器视图用 65% 宽度，其他面板用 sidebarWidth
  const isBrowserVisible = openView === 'browser' || browserOpen;
  const leftPanelWidth = isBrowserVisible ? '65%' : sidebarWidth;
  const isLeftOpen = isBrowserVisible || (openView && openView !== 'agent');

  const hasInitRef = React.useRef(false);
  useEffect(() => {
    if (hasInitRef.current) return;
    hasInitRef.current = true;
    (async () => {
      const convStore = useConversationStore.getState();
      await convStore.migrateFromSessions();
      await convStore.loadAll();
      const { conversations, activeId } = useConversationStore.getState();
      if (conversations.length === 0 && !activeId) {
        useConversationStore.getState().createSolo();
      }
    })();
    if (!activeTermId) {
      createTerminal();
    }
  }, []);

  const getLanguage = (name: string): string => {
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
    if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
    if (name.endsWith('.py')) return 'python';
    if (name.endsWith('.json')) return 'json';
    if (name.endsWith('.md')) return 'markdown';
    if (name.endsWith('.css')) return 'css';
    if (name.endsWith('.html')) return 'html';
    if (name.endsWith('.yml') || name.endsWith('.yaml')) return 'yaml';
    return 'text';
  };

  const handleSystemAction = (action: SystemMenuAction) => {
    if (action === 'theme') setShowThemeSettings(true);
    else if (action === 'terminal') { setBottomClosed(false); setBottomExpanded(true); }
    else if (action === 'model') setShowModelSettings(true);
    else if (action === 'characters') setShowCharacterSettings(true);
    else if (action === 'agent-roles') setShowAgentRoles(true);
    else if (action === 'about') setShowAbout(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Title Bar */}
      <div style={{
        height: 32, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', position: 'relative',
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ minWidth: 100, display: 'flex', alignItems: 'center', paddingLeft: 12, WebkitAppRegion: 'no-drag' }}>
          <button
            onClick={() => setRoleplay(mode !== 'roleplay')}
            title={mode === 'roleplay' ? '关闭角色扮演，返回上次模式' : '开启角色扮演模式'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
              border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12, padding: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 30, height: 16, borderRadius: 8, position: 'relative', flexShrink: 0,
              background: mode === 'roleplay' ? 'var(--accent)' : 'var(--border)',
              transition: 'background 0.2s',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: mode === 'roleplay' ? 16 : 2,
                width: 12, height: 12, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </span>
            <span>角色扮演</span>
          </button>
        </div>
        <span style={{ flex: 1, textAlign: 'center' }}><img src="./assets/logo.png" alt="" style={{ width: 16, height: 14, marginRight: 6, verticalAlign: 'middle' }} />Oh My DeepSeek</span>
        <div style={{ width: 100, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingRight: 12, WebkitAppRegion: 'no-drag' }}>
          <WindowControlBtn onClick={() => window.api.window.minimize()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor" /></svg>
          </WindowControlBtn>
          <WindowControlBtn onClick={() => { window.api.window.maximize(); setMaximized(!maximized); }}>
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /><rect x="3" y="2" width="7" height="7" rx="1" fill="var(--bg-primary)" stroke="currentColor" strokeWidth="1.2" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            )}
          </WindowControlBtn>
          <WindowControlBtn onClick={() => window.api.window.close()}>
            <svg width="12" height="12" viewBox="0 0 12 12"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.3" /><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.3" /></svg>
          </WindowControlBtn>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {showAccountCenter ? (
          <AccountCenter onClose={() => setShowAccountCenter(false)} />
        ) : (
        <>
        {/* Activity Bar — 最左边 */}
        <ActivityBar
          openView={isBrowserVisible ? 'browser' : openView}
          onToggle={handleToggleView}
          onSystemAction={handleSystemAction}
          onOpenLogin={() => setShowAccountCenter(true)}
          username={authUser?.username ?? null}
          avatar={authUser?.avatar ?? null}
        />

        {/* Left Panel — files/sessions/browser 滑动面板 */}
        <div data-area="sidebar" style={{
          width: isLeftOpen ? leftPanelWidth : 0,
          flexShrink: 0, background: 'var(--bg-secondary)',
          borderRight: isLeftOpen ? '1px solid var(--border)' : 'none',
          height: '100%', overflow: 'hidden',
          transition: sidebarResizing ? 'none' : 'width 0.2s ease',
        }}>
          <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            {!isBrowserVisible && openView === 'files' && <Sidebar />}
            {!isBrowserVisible && openView === 'sessions' && <ChatList />}

            {!isBrowserVisible && openView === 'git' && <GitPanel />}
            {!isBrowserVisible && openView === 'roleplay' && <CharacterPickerPanel />}
            {!isBrowserVisible && openView === 'timeline' && <TimelinePanel />}
            {isBrowserVisible && <BrowserView initialUrl={browserUrl} />}
          </div>
        </div>
        {isLeftOpen && !isBrowserVisible && (
          <SidebarResizeHandle
            width={sidebarWidth}
            minWidth={SIDEBAR_MIN_WIDTH}
            onWidthChange={setSidebarWidth}
            onCollapse={() => {
              setBrowserOpen(false);
              setOpenView(null);
            }}
            onDragStart={() => setSidebarResizing(true)}
            onDragEnd={() => setSidebarResizing(false)}
          />
        )}

        {/* 中间区域（Editor + Chat + Bottom Panel） */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 上半：Editor + Chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            {/* Editor Area — 仅在有打开的文件时显示 */}
            {openTabs.length > 0 && (
              <>
                <div data-area="editor" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <EditorTabs />
                  <div style={{ flex: 1, overflow: 'hidden', display: activeFile ? 'flex' : 'none', flexDirection: 'column', minHeight: 0 }}>
                    {activeFile?.kind === 'diff' ? (
                      activeFile.diffOriginal === activeFile.diffModified ? (
                        <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>无差异</div>
                      ) : (
                        <DiffView
                          original={activeFile.diffOriginal || ''}
                          modified={activeFile.diffModified || ''}
                          language={activeFile.language || 'text'}
                          originalLabel={activeFile.originalLabel}
                          modifiedLabel={activeFile.modifiedLabel}
                          fill
                          inline={false}
                        />
                      )
                    ) : activeFile && isImageFile(activeFile.name) ? (
                      <ImageViewer filePath={activeFile.path} />
                    ) : activeFile ? (
                      <CodeEditor
                        filePath={activeFile.path}
                        content={activeFile.content || '// Select a file to view its contents'}
                        language={getLanguage(activeFile.name)}
                        onChange={(value) => value !== undefined && updateTabContent(activeFile.path, value)}
                      />
                    ) : null}
                  </div>
                </div>
                <ResizeHandle direction="horizontal" onResize={(d) => setChatPanelWidth(w => Math.max(260, w - d))} />
              </>
            )}
            <div data-area="chat" style={{
              width: openTabs.length > 0 ? chatPanelWidth : '100%',
              flex: openTabs.length > 0 ? '0 0 auto' : 1,
              flexShrink: 0, overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              borderLeft: openTabs.length > 0 ? '1px solid var(--border)' : 'none',
            }}>
              <ChatWorkspace />
            </div>
          </div>
          {/* Bottom Panel */}
          {bottomClosed ? (
            <div style={{ height: 4, background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', flexShrink: 0 }} />
          ) : (
            <>
              <ResizeHandle direction="vertical" onResize={(d) => {
                if (!bottomExpanded) { setBottomExpanded(true); }
                setTerminalHeight(h => Math.max(80, h - d));
              }} />
              <div data-area="terminal" style={{
                height: bottomExpanded ? terminalHeight : 28, flexShrink: 0,
                background: 'var(--terminal-bg)', borderTop: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column',
              }}>
                <TerminalTabs />
                {bottomExpanded && activeTermId && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <TerminalPanel termId={activeTermId} />
                    </div>
                    <TerminalList />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Agent Panel — 右侧滑动面板 */}
        <div data-area="agentPanel" style={{
          width: openView === 'agent' ? agentPanelWidth : 0,
          flexShrink: 0, background: 'var(--bg-secondary)',
          borderLeft: openView === 'agent' ? '1px solid var(--border)' : 'none',
          height: '100%', overflow: 'hidden',
          transition: 'width 0.2s ease',
        }}>
          <div style={{ width: agentPanelWidth, height: '100%' }}>
            <AgentPanel onClose={() => setOpenView(null)} />
          </div>
        </div>
        {openView === 'agent' && (
          <ResizeHandle direction="horizontal" onResize={(d) => setAgentPanelWidth(w => Math.max(200, w - d))} />
        )}
        </>
        )}
      </div>

      {/* Status Bar */}
      {showModelSettings && <ModelSettings onClose={() => setShowModelSettings(false)} />}
      {showAgentRoles && <MultiAgentSettings onClose={() => setShowAgentRoles(false)} />}
      {showThemeSettings && <ThemeSettings onClose={() => setShowThemeSettings(false)} />}
      {showCharacterSettings && <CharacterSettings onClose={() => setShowCharacterSettings(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {showQuickOpen && <QuickOpen onClose={() => setShowQuickOpen(false)} />}
      {askpassRequest && (
        <GitPassphraseDialog
          prompt={askpassRequest.prompt}
          keyPath={askpassRequest.keyPath}
          onSubmit={(password, remember) => {
            window.api.git.askpassResponse({ id: askpassRequest.id, password, remember });
            setAskpassRequest(null);
          }}
          onCancel={() => {
            window.api.git.askpassResponse({ id: askpassRequest.id, cancelled: true });
            setAskpassRequest(null);
          }}
        />
      )}
      <StatusBar language={showAccountCenter ? '' : (activeFile ? (activeFile.kind === 'diff' ? activeFile.language || '' : getLanguage(activeFile.name)) : '')} />
      <Toast />
      <Confirm />
    </div>
  );
}

function WindowControlBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={styles.windowBtn}>{children}</button>;
}
