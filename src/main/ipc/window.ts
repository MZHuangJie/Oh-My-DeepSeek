import { ipcMain, BrowserWindow } from 'electron';

export function setupWindowHandlers() {
  ipcMain.handle('window:minimize', async () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });

  ipcMain.handle('window:maximize', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) { win.unmaximize(); } else { win?.maximize(); }
  });

  ipcMain.handle('window:close', async () => {
    BrowserWindow.getFocusedWindow()?.close();
  });

  ipcMain.handle('window:isMaximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
}
