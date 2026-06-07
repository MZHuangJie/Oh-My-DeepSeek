import { ipcMain, BrowserWindow } from 'electron';
import { streamChat } from '../agent/client';

export function setupExplainHandlers() {
  ipcMain.handle('explain:send', async (event, payload: {
    apiKey: string;
    model: string;
    baseUrl: string;
    messages: Array<{ role: string; content: string }>;
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('找不到窗口');

    try {
      const result = await streamChat(
        payload.apiKey,
        payload.messages,
        [], // no tools
        { model: payload.model, baseUrl: payload.baseUrl },
        {
          onContent: (text) => {
            if (!win.isDestroyed()) win.webContents.send('explain:chunk', { text });
          },
          onThinking: () => {},
        },
      );
      if (!win.isDestroyed()) win.webContents.send('explain:done');
      return { success: true, content: result.content };
    } catch (err: any) {
      if (!win.isDestroyed()) win.webContents.send('explain:done');
      return { success: false, error: err.message || String(err) };
    }
  });
}
