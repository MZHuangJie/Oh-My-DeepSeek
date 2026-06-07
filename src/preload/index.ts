import { contextBridge, ipcRenderer } from 'electron';

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  files: {
    list: (dirPath: string) => ipcRenderer.invoke('files:list', dirPath),
    listTree: () => ipcRenderer.invoke('files:listTree'),
    read: (filePath: string) => ipcRenderer.invoke('files:read', filePath),
    cwd: () => ipcRenderer.invoke('files:cwd'),
    selectWorkspace: () => ipcRenderer.invoke('files:select-workspace'),
    openFile: () => ipcRenderer.invoke('files:open-file'),
    closeWorkspace: () => ipcRenderer.invoke('files:close-workspace'),
    setWorkspace: (workspacePath: string) => ipcRenderer.invoke('files:set-workspace', workspacePath),
    getRecentWorkspaces: () => ipcRenderer.invoke('files:get-recent'),
    removeRecentWorkspace: (p: string) => ipcRenderer.invoke('files:remove-recent', p),
    onTreeChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('files:tree-changed', handler);
      return () => ipcRenderer.removeListener('files:tree-changed', handler);
    },
    createFile: (filePath: string) => ipcRenderer.invoke('files:create-file', filePath),
    createDirectory: (dirPath: string) => ipcRenderer.invoke('files:create-directory', dirPath),
    delete: (targetPath: string) => ipcRenderer.invoke('files:delete', targetPath),
    rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('files:rename', oldPath, newPath),
    write: (filePath: string, content: string) => ipcRenderer.invoke('files:write', filePath, content),
    readBinary: (filePath: string) => ipcRenderer.invoke('files:readBinary', filePath),
    showInExplorer: (filePath: string) => ipcRenderer.invoke('files:show-in-explorer', filePath),
    saveClipboardImage: (base64: string, mimeType: string) => ipcRenderer.invoke('files:save-clipboard-image', base64, mimeType),
    saveBase64Image: (base64DataUrl: string, targetPath: string) => ipcRenderer.invoke('files:saveBase64Image', base64DataUrl, targetPath),
    downloadImage: (base64DataUrl: string, defaultName: string) => ipcRenderer.invoke('files:downloadImage', base64DataUrl, defaultName),
    fetchAsDataUrl: (url: string) => ipcRenderer.invoke('files:fetchAsDataUrl', url),
    searchContent: (
      query: string,
      filter: 'all' | 'code' | 'document',
      filePaths: string[],
      handlers: {
        onBatch: (matches: Array<{
          path: string;
          name: string;
          line: number;
          preview: string;
          score: number;
        }>, progress: { scannedFiles: number; totalFiles: number; matchCount: number }) => void;
        onDone: () => void;
      },
    ) => {
      const searchId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const onBatch = (_: unknown, data: {
        searchId: string;
        matches: Array<{
          path: string;
          name: string;
          line: number;
          preview: string;
          score: number;
        }>;
        progress: { scannedFiles: number; totalFiles: number; matchCount: number };
      }) => {
        if (data.searchId !== searchId) return;
        handlers.onBatch(data.matches, data.progress);
      };
      const onDone = (_: unknown, data: { searchId: string }) => {
        if (data.searchId !== searchId) return;
        cleanup();
        handlers.onDone();
      };
      const cleanup = () => {
        ipcRenderer.removeListener('files:search-content-batch', onBatch);
        ipcRenderer.removeListener('files:search-content-done', onDone);
      };

      ipcRenderer.on('files:search-content-batch', onBatch);
      ipcRenderer.on('files:search-content-done', onDone);
      void ipcRenderer.invoke('files:search-content', { searchId, query, filter, filePaths });

      return () => {
        cleanup();
        void ipcRenderer.invoke('files:search-content-cancel', searchId);
      };
    },
  },
  agent: {
    send: (messages: unknown) => ipcRenderer.invoke('agent:send', messages),
    cancel: (sessionId?: string) => ipcRenderer.invoke('agent:cancel', sessionId),
    onStreamChunk: (cb: (chunk: unknown) => void) => {
      const handler = (_: unknown, chunk: unknown) => cb(chunk);
      ipcRenderer.on('agent:stream-chunk', handler);
      return () => ipcRenderer.removeListener('agent:stream-chunk', handler);
    },
    onConfirmRequest: (cb: (req: any) => void) => {
      const handler = (_: unknown, req: any) => cb(req);
      ipcRenderer.on('agent:confirm-request', handler);
      return () => ipcRenderer.removeListener('agent:confirm-request', handler);
    },
    confirmResponse: (confirmId: string, approved: boolean) => {
      ipcRenderer.send('agent:confirm-response', { confirmId, approved });
    },
    onChoiceRequest: (cb: (req: any) => void) => {
      const handler = (_: unknown, req: any) => cb(req);
      ipcRenderer.on('agent:choice-request', handler);
      return () => ipcRenderer.removeListener('agent:choice-request', handler);
    },
    choiceResponse: (choiceId: string, selected: number[], feedback: string, cancelled: boolean) => {
      ipcRenderer.send('agent:choice-response', { choiceId, selected, feedback, cancelled });
    },
  },
  terminal: {
    create: (shell?: string) => ipcRenderer.invoke('terminal:create', shell),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
    onData: (id: string, cb: (data: string) => void) => {
      const handler = (_: unknown, data: { id: string; output: string }) => {
        if (data.id === id) cb(data.output);
      };
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getApiKey: () => ipcRenderer.invoke('settings:getApiKey'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:setApiKey', key),
    getBalance: () => ipcRenderer.invoke('settings:getBalance'),
  },
  auth: {
    getApiBase: () => ipcRenderer.invoke('auth:getApiBase'),
    isApiBaseEditable: () => ipcRenderer.invoke('auth:isApiBaseEditable'),
    setApiBase: (baseUrl: string) => ipcRenderer.invoke('auth:setApiBase', baseUrl),
    login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),
    register: (username: string, password: string, email?: string) => ipcRenderer.invoke('auth:register', username, password, email),
    restore: () => ipcRenderer.invoke('auth:restore'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    updateProfile: (updates: { username?: string; email?: string; avatar?: string }) => ipcRenderer.invoke('auth:updateProfile', updates),
    healthCheck: (baseUrl?: string) => ipcRenderer.invoke('auth:healthCheck', baseUrl),
  },
  sessions: {
    save: (id: string, title: string, messages: string) => ipcRenderer.invoke('sessions:save', id, title, messages),
    loadAll: () => ipcRenderer.invoke('sessions:loadAll'),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    generateTitle: (payload: {
      userMessage: string;
      assistantPreview?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
    }) => ipcRenderer.invoke('sessions:generateTitle', payload),
  },
  conversations: {
    save: (id: string, title: string, payload: string) => ipcRenderer.invoke('conversations:save', id, title, payload),
    loadAll: () => ipcRenderer.invoke('conversations:loadAll'),
    delete: (id: string) => ipcRenderer.invoke('conversations:delete', id),
    getMigrated: () => ipcRenderer.invoke('conversations:getMigrated'),
    setMigrated: () => ipcRenderer.invoke('conversations:setMigrated'),
  },
  groupChat: {
    send: (convJson: string, userMessage: string) => ipcRenderer.invoke('group-chat:send', convJson, userMessage),
    cancel: (convId: string) => ipcRenderer.invoke('group-chat:cancel', convId),
    onChunk: (cb: (convId: string, chunk: unknown) => void) => {
      const handler = (_: unknown, convId: string, chunk: unknown) => cb(convId, chunk);
      ipcRenderer.on('group-chat:chunk', handler);
      return () => ipcRenderer.removeListener('group-chat:chunk', handler);
    },
  },
  explain: {
    send: (payload: { apiKey: string; model: string; baseUrl: string; messages: Array<{ role: string; content: string }> }) =>
      ipcRenderer.invoke('explain:send', payload),
    onChunk: (cb: (text: string) => void) => {
      const handler = (_: unknown, data: { text: string }) => cb(data.text);
      ipcRenderer.on('explain:chunk', handler);
      return () => ipcRenderer.removeListener('explain:chunk', handler);
    },
    onDone: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('explain:done', handler);
      return () => ipcRenderer.removeListener('explain:done', handler);
    },
  },
  sync: {
    listSessions: () => ipcRenderer.invoke('sync:listSessions'),
    getSession: (sessionId: string) => ipcRenderer.invoke('sync:getSession', sessionId),
    pushSession: (sessionId: string, title: string, payload: string) => ipcRenderer.invoke('sync:pushSession', sessionId, title, payload),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('sync:deleteSession', sessionId),
    listCharacters: () => ipcRenderer.invoke('sync:listCharacters'),
    getCharacter: (characterId: string) => ipcRenderer.invoke('sync:getCharacter', characterId),
    pushCharacter: (characterId: string, name: string, payload: string) => ipcRenderer.invoke('sync:pushCharacter', characterId, name, payload),
    deleteCharacter: (characterId: string) => ipcRenderer.invoke('sync:deleteCharacter', characterId),
    listTemplates: () => ipcRenderer.invoke('sync:listTemplates'),
    getTemplate: (templateId: string) => ipcRenderer.invoke('sync:getTemplate', templateId),
    pushTemplate: (templateId: string, name: string, payload: string) => ipcRenderer.invoke('sync:pushTemplate', templateId, name, payload),
    deleteTemplate: (templateId: string) => ipcRenderer.invoke('sync:deleteTemplate', templateId),
  },
  square: {
    listCharacters: () => ipcRenderer.invoke('square:listCharacters'),
    listModels: () => ipcRenderer.invoke('square:listModels'),
    toggleCharacterShared: (id: string) => ipcRenderer.invoke('square:toggleCharacterShared', id),
    toggleModelShared: (id: string) => ipcRenderer.invoke('square:toggleModelShared', id),
    pushModel: (payload: Record<string, unknown>) => ipcRenderer.invoke('square:pushModel', payload),
    deleteModel: (id: string) => ipcRenderer.invoke('square:deleteModel', id),
    listMyModels: () => ipcRenderer.invoke('square:listMyModels'),
    favoriteCharacter: (id: string) => ipcRenderer.invoke('square:favoriteCharacter', id),
    listFavorites: () => ipcRenderer.invoke('square:listFavorites'),
    listTemplates: () => ipcRenderer.invoke('square:listTemplates'),
    toggleTemplateShared: (id: string) => ipcRenderer.invoke('square:toggleTemplateShared', id),
  },
  marketplace: {
    add: (url: string) => ipcRenderer.invoke('marketplace:add', url),
    remove: (id: string) => ipcRenderer.invoke('marketplace:remove', id),
    list: () => ipcRenderer.invoke('marketplace:list'),
  },
  plugins: {
    discover: () => ipcRenderer.invoke('plugin:discover'),
    install: (meta: { name: string; source: string; downloadUrl: string }) => ipcRenderer.invoke('plugin:install', meta),
    uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name),
    listInstalled: () => ipcRenderer.invoke('plugin:list-installed'),
    getErrors: () => ipcRenderer.invoke('plugin:get-errors'),
    clearErrors: () => ipcRenderer.invoke('plugin:clear-errors'),
  },
  browser: {
    open: (url?: string) => ipcRenderer.invoke('browser:open', url),
    openInline: (url: string) => ipcRenderer.invoke('browser:open-inline', url),
    navigate: (id: number, url: string) => ipcRenderer.invoke('browser:navigate', id, url),
    onLoadUrl: (cb: (url: string) => void) => {
      const handler = (_: unknown, data: { url: string }) => cb(data.url);
      ipcRenderer.on('browser:load-url', handler);
      return () => { ipcRenderer.removeListener('browser:load-url', handler); };
    },
  },
  git: {
    status: () => ipcRenderer.invoke('git:status'),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (payload: { branch: string; create?: boolean }) => ipcRenderer.invoke('git:checkout', payload),
    init: () => ipcRenderer.invoke('git:init'),
    diff: (payload?: { path?: string; staged?: boolean }) => ipcRenderer.invoke('git:diff', payload),
    diffContent: (payload: { path: string; staged?: boolean }) => ipcRenderer.invoke('git:diff-content', payload),
    stage: (paths: string[]) => ipcRenderer.invoke('git:stage', paths),
    stageAll: () => ipcRenderer.invoke('git:stage-all'),
    unstage: (paths: string[]) => ipcRenderer.invoke('git:unstage', paths),
    unstageAll: () => ipcRenderer.invoke('git:unstage-all'),
    discard: (paths: string[]) => ipcRenderer.invoke('git:discard', paths),
    discardAll: () => ipcRenderer.invoke('git:discard-all'),
    cleanUntracked: () => ipcRenderer.invoke('git:clean-untracked'),
    commit: (message: string) => ipcRenderer.invoke('git:commit', message),
    fetch: () => ipcRenderer.invoke('git:fetch'),
    pull: () => ipcRenderer.invoke('git:pull'),
    pullRebase: () => ipcRenderer.invoke('git:pull-rebase'),
    push: () => ipcRenderer.invoke('git:push'),
    publish: () => ipcRenderer.invoke('git:publish'),
    sync: () => ipcRenderer.invoke('git:sync'),
    log: (limit?: number) => ipcRenderer.invoke('git:log', limit),
    graph: (limit?: number) => ipcRenderer.invoke('git:graph', limit),
    stashList: () => ipcRenderer.invoke('git:stash-list'),
    stashPush: (message?: string) => ipcRenderer.invoke('git:stash-push', message),
    stashPop: () => ipcRenderer.invoke('git:stash-pop'),
    onAskpassRequest: (cb: (req: { id: string; prompt: string; keyPath: string }) => void) => {
      const handler = (_: unknown, req: { id: string; prompt: string; keyPath: string }) => cb(req);
      ipcRenderer.on('git:askpass-request', handler);
      return () => ipcRenderer.removeListener('git:askpass-request', handler);
    },
    askpassResponse: (payload: { id: string; password?: string; remember?: boolean; cancelled?: boolean }) => {
      ipcRenderer.send('git:askpass-response', payload);
    },
  },
  roleplay: {
    listTemplates: () => ipcRenderer.invoke('roleplay:listTemplates'),
    saveTemplate: (payload: Record<string, unknown>) => ipcRenderer.invoke('roleplay:saveTemplate', payload),
    deleteTemplate: (id: string) => ipcRenderer.invoke('roleplay:deleteTemplate', id),
    listCharacters: () => ipcRenderer.invoke('roleplay:listCharacters'),
    saveCharacter: (payload: Record<string, unknown>) => ipcRenderer.invoke('roleplay:saveCharacter', payload),
    deleteCharacter: (id: string) => ipcRenderer.invoke('roleplay:deleteCharacter', id),
    createFromTemplate: (templateId: string) => ipcRenderer.invoke('roleplay:createFromTemplate', templateId),
	    generateRandomTemplate: (keywords: string) => ipcRenderer.invoke('roleplay:generateRandomTemplate', keywords),
	    generateRandomCharacter: (templateId: string) => ipcRenderer.invoke('roleplay:generateRandomCharacter', templateId),
    setActiveCharacter: (id: string | null) => ipcRenderer.invoke('roleplay:setActiveCharacter', id),
    pickPortrait: (ownerId: string, copy?: boolean) => ipcRenderer.invoke('roleplay:pickPortrait', ownerId, copy),
    generatePortrait: async (
      ownerId: string,
      payload: Record<string, unknown>,
      onProgress?: (stage: 'prompt' | 'image') => void,
    ) => {
      const handler = (_: unknown, data: { stage: 'prompt' | 'image' }) => {
        onProgress?.(data.stage);
      };
      if (onProgress) ipcRenderer.on('roleplay:portrait-progress', handler);
      try {
        return await ipcRenderer.invoke('roleplay:generatePortrait', ownerId, payload);
      } finally {
        if (onProgress) ipcRenderer.removeListener('roleplay:portrait-progress', handler);
      }
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

export type API = typeof api;
