import { ipcMain, dialog, BrowserWindow, shell, net } from 'electron';
import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from '../db/settings';
import { syncTerminalCwd } from '../ipc/terminal';
import { safeResolve, checkSensitiveFile } from '../agent/tools/security';
import { validateExternalUrl } from '../security/url';

let currentWorkspace = getSetting('last_workspace') || '';
let fileWatcher: fs.FSWatcher | null = null;
let watchDebounce: ReturnType<typeof setTimeout> | null = null;

function saveWorkspace() {
  setSetting('last_workspace', currentWorkspace);
}

/** 确保工作区根目录存在 DEEPSEEK.md（空白的），方便用户填写项目规则 */
function ensureDeepseekMd(workspacePath: string) {
  const mdPath = path.join(workspacePath, 'DEEPSEEK.md');
  if (!fs.existsSync(mdPath)) {
    try {
      fs.writeFileSync(mdPath, '', 'utf-8');
    } catch {
      // 权限不足等情况静默跳过
    }
  }
}

function startWatching(win: BrowserWindow) {
  stopWatching();
  if (!currentWorkspace) return;
  try {
    fileWatcher = fs.watch(currentWorkspace, { recursive: true }, (_event, filename) => {
      // 忽略 .git 和 .ohmydeepseek 内部变化，避免 Git 操作触发无限刷新循环
      if (filename) {
        const p = filename.replace(/\\/g, '/');
        if (p.startsWith('.git/') || p === '.git' || p.startsWith('.ohmydeepseek/') || p === '.ohmydeepseek') {
          return;
        }
      }
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        if (!win.isDestroyed()) {
          win.webContents.send('files:tree-changed');
        }
      }, 300);
    });
  } catch {
    // fs.watch 在某些系统上可能不可用，静默忽略
  }
}

function stopWatching() {
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
}

export function getCurrentWorkspace(): string {
  return currentWorkspace;
}

function getRecentWorkspaces(): string[] {
  try {
    const raw = getSetting('recent_workspaces');
    const list: string[] = raw ? JSON.parse(raw) : [];
    return list.filter(p => {
      try { return fs.existsSync(p); } catch { return false; }
    });
  } catch {
    return [];
  }
}

function addToRecentWorkspaces(workspacePath: string) {
  try {
    let recent = getRecentWorkspaces();
    recent = recent.filter(p => p !== workspacePath);
    recent.unshift(workspacePath);
    recent = recent.slice(0, 10);
    setSetting('recent_workspaces', JSON.stringify(recent));
  } catch (err) {
    console.error('Failed to save recent workspaces:', err);
  }
}

export function setupFileHandlers() {
  ipcMain.handle('files:list', async (_event, dirPath: string) => {
    if (!currentWorkspace) return [];
    const safePath = safeResolve(currentWorkspace, dirPath);
    const entries = fs.readdirSync(safePath, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(safePath, e.name),
    }));
  });

  ipcMain.handle('files:listTree', async () => {
    if (!currentWorkspace) return [];
    const result: Array<{ name: string; isDirectory: boolean; path: string; children?: typeof result }> = [];
    const MAX_DEPTH = 8;
    function walk(dir: string, depth: number) {
      if (depth > MAX_DEPTH) return [];
      const entries: typeof result = [];
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, e.name);
          const node: typeof result[number] = { name: e.name, isDirectory: e.isDirectory(), path: fullPath };
          if (e.isDirectory()) {
            const children = walk(fullPath, depth + 1);
            if (children.length > 0) (node as any).children = children;
          }
          entries.push(node);
        }
      } catch { /* permission errors */ }
      entries.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name));
      return entries;
    }
    return walk(currentWorkspace, 0);
  });

  ipcMain.handle('files:read', async (_event, filePath: string) => {
    const safePath = safeResolve(currentWorkspace, filePath);
    checkSensitiveFile(safePath, 'read');
    return fs.readFileSync(safePath, 'utf-8');
  });

  ipcMain.handle('files:readBinary', async (_event, filePath: string) => {
    // 云端 URL：通过 Electron net 下载后转 base64，避免 <img> 直接请求因缺少认证头 401/403
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      try {
        const validated = validateExternalUrl(filePath);
        return await new Promise<string>((resolve, reject) => {
          const req = net.request({ method: 'GET', url: validated.href });
          const chunks: Buffer[] = [];
          req.on('response', (res) => {
            if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
              reject(new Error("图片加载失败: HTTP " + res.statusCode));
              return;
            }
            const contentType = res.headers['content-type']?.[0] || 'image/png';
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              resolve('data:' + contentType + ';base64,' + buf.toString('base64'));
            });
            res.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        });
      } catch {
        return null;
      }
    }
    const safePath = safeResolve(currentWorkspace, filePath);
    if (!fs.existsSync(safePath)) return null;
    const buf = fs.readFileSync(safePath);
    const ext = path.extname(safePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  });

  ipcMain.handle('files:cwd', async () => {
    return currentWorkspace;
  });

  ipcMain.handle('files:select-workspace', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: '打开文件夹',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const selectedPath = result.filePaths[0];
    currentWorkspace = selectedPath;
    saveWorkspace();
    addToRecentWorkspaces(selectedPath);
    syncTerminalCwd(selectedPath);
    ensureDeepseekMd(selectedPath);
    startWatching(win);
    return selectedPath;
  });

  ipcMain.handle('files:close-workspace', async () => {
    stopWatching();
    currentWorkspace = '';
    saveWorkspace();
    return true;
  });

  ipcMain.handle('files:open-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: '打开文件',
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const workspacePath = path.dirname(filePath);
    currentWorkspace = workspacePath;
    saveWorkspace();
    addToRecentWorkspaces(workspacePath);
    syncTerminalCwd(workspacePath);
    ensureDeepseekMd(workspacePath);
    startWatching(win);
    return { workspace: workspacePath, openFile: filePath };
  });

  ipcMain.handle('files:set-workspace', async (event, workspacePath: string) => {
    if (fs.existsSync(workspacePath)) {
      currentWorkspace = workspacePath;
      saveWorkspace();
      addToRecentWorkspaces(workspacePath);
      syncTerminalCwd(workspacePath);
      ensureDeepseekMd(workspacePath);
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) startWatching(win);
      return true;
    }
    return false;
  });

  ipcMain.handle('files:get-recent', async () => {
    return getRecentWorkspaces();
  });

  ipcMain.handle('files:remove-recent', async (_event, workspacePath: string) => {
    let recent = getRecentWorkspaces();
    recent = recent.filter(p => p !== workspacePath);
    setSetting('recent_workspaces', JSON.stringify(recent));
    return recent;
  });

  ipcMain.handle('files:create-file', async (_event, filePath: string) => {
    const safePath = safeResolve(currentWorkspace, filePath);
    if (fs.existsSync(safePath)) {
      throw new Error(`文件已存在: ${filePath}`);
    }
    fs.writeFileSync(safePath, '');
    return { success: true };
  });

  ipcMain.handle('files:create-directory', async (_event, dirPath: string) => {
    const safePath = safeResolve(currentWorkspace, dirPath);
    fs.mkdirSync(safePath, { recursive: true });
    return { success: true };
  });

  ipcMain.handle('files:write', async (_event, filePath: string, content: string) => {
    const safePath = safeResolve(currentWorkspace, filePath);
    checkSensitiveFile(safePath, 'write');
    fs.writeFileSync(safePath, content, 'utf-8');
    return { success: true };
  });

  ipcMain.handle('files:rename', async (_event, oldPath: string, newPath: string) => {
    const safeOld = safeResolve(currentWorkspace, oldPath);
    const safeNew = safeResolve(currentWorkspace, newPath);
    if (!fs.existsSync(safeOld)) {
      throw new Error(`路径不存在: ${oldPath}`);
    }
    if (fs.existsSync(safeNew)) {
      throw new Error(`目标已存在: ${newPath}`);
    }
    fs.renameSync(safeOld, safeNew);
    return { success: true };
  });

  ipcMain.handle('files:delete', async (_event, targetPath: string) => {
    const safePath = safeResolve(currentWorkspace, targetPath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`路径不存在: ${targetPath}`);
    }
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }
    return { success: true };
  });

  ipcMain.handle('files:show-in-explorer', async (_event, filePath: string) => {
    const safePath = safeResolve(currentWorkspace, filePath);
    if (fs.existsSync(safePath)) {
      shell.showItemInFolder(safePath);
    }
    return { success: true };
  });

  ipcMain.handle('files:save-clipboard-image', async (_event, data: Uint8Array, mimeType: string) => {
    const clipboardDir = path.join(currentWorkspace, '.ohmydeepseek', 'clipboard');
    fs.mkdirSync(clipboardDir, { recursive: true });
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const filePath = path.join(clipboardDir, filename);
    fs.writeFileSync(filePath, Buffer.from(data));
    return filePath;
  });

  ipcMain.handle('files:fetchAsDataUrl', async (_event, url: string) => {
    const validated = validateExternalUrl(url);
    return new Promise<string>((resolve, reject) => {
      const req = net.request({ method: 'GET', url: validated.href });
      const chunks: Buffer[] = [];
      req.on('response', (res) => {
        const contentType = res.headers['content-type']?.[0] || 'image/png';
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve(`data:${contentType};base64,${buf.toString('base64')}`);
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  });

  ipcMain.handle('files:saveBase64Image', async (_event, base64DataUrl: string, targetPath: string) => {
    const safePath = safeResolve(currentWorkspace, targetPath);
    const match = base64DataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error('Invalid base64 data URL');
    const [, mimeType, base64] = match;
    const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const destPath = safePath.endsWith(`.${ext}`) ? safePath : `${safePath}.${ext}`;
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });
    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(destPath, buffer);
    return destPath;
  });

  ipcMain.handle('files:downloadImage', async (event, base64DataUrl: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('窗口不可用');
    const result = await dialog.showSaveDialog(win, {
      title: '保存图片',
      defaultPath: defaultName,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    const match = base64DataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error('Invalid base64 data URL');
    const [, mimeType, base64] = match;
    const ext = (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const destPath = result.filePath.endsWith(`.${ext}`) ? result.filePath : `${result.filePath}.${ext}`;
    fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
    return destPath;
  });

  const activeContentSearches = new Map<string, AbortController>();

  ipcMain.handle(
    'files:search-content',
    async (event, payload: { searchId: string; query: string; filter: 'all' | 'code' | 'document'; filePaths?: string[] }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const controller = new AbortController();
      activeContentSearches.set(payload.searchId, controller);

      try {
        const { searchContentStreaming } = await import('../services/contentSearch');
        await searchContentStreaming({
          workspace: currentWorkspace,
          query: payload.query,
          filter: payload.filter,
          filePaths: payload.filePaths,
          signal: controller.signal,
          onBatch: (matches, progress) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send('files:search-content-batch', {
                searchId: payload.searchId,
                matches,
                progress,
              });
            }
          },
        });
      } catch (err) {
        console.error('[files:search-content] failed:', err);
      } finally {
        activeContentSearches.delete(payload.searchId);
        if (win && !win.isDestroyed()) {
          win.webContents.send('files:search-content-done', { searchId: payload.searchId });
        }
      }
    },
  );

  ipcMain.handle('files:search-content-cancel', async (_event, searchId: string) => {
    activeContentSearches.get(searchId)?.abort();
    activeContentSearches.delete(searchId);
    return { success: true };
  });
}
