import path from 'path';
import { app } from 'electron';

interface Stmt {
  run(...args: any[]): void;
  all(...args: any[]): any[];
  get(...args: any[]): any;
}

interface DbLike {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  pragma(sql: string): void;
  run(sql: string, params?: any[]): void;
  all(sql: string, params?: any[]): any[];
}

let db: DbLike | null = null;

class MemDb implements DbLike {
  private tables = new Map<string, Map<string, any> | any[]>();

  exec(sql: string) {
    const match = sql.match(/CREATE TABLE IF NOT EXISTS (\w+) \((.*)\)/s);
    if (match) {
      const tableName = match[1];
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, new Map());
      }
    }
  }

  prepare(sql: string): Stmt {
    const self = this;
    const getMap = (name: string): Map<string, any> => {
      const t = self.tables.get(name);
      return (t instanceof Map ? t : new Map()) as Map<string, any>;
    };
    const getArr = (name: string): any[] => {
      const t = self.tables.get(name);
      return Array.isArray(t) ? t : [];
    };
    return {
      run: (...args: any[]) => {
        if (sql.includes('INSERT INTO sessions') || sql.includes('INSERT OR REPLACE INTO sessions')) {
          const row = { id: args[0], title: args[1], messages: args[2], created_at: args[3], updated_at: args[4] };
          const sessions = getMap('sessions');
          const existing = sessions.get(args[0]);
          if (existing && args.length > 5) {
            sessions.set(args[0], { ...row, created_at: existing.created_at });
          } else {
            sessions.set(args[0], row);
          }
          self.tables.set('sessions', sessions);
        } else if (sql.includes('INSERT INTO conversations') || sql.includes('INSERT OR REPLACE INTO conversations')) {
          const row = { id: args[0], title: args[1], payload: args[2], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          const conversations = getMap('conversations');
          const existing = conversations.get(args[0]);
          if (existing) {
            conversations.set(args[0], { ...row, created_at: existing.created_at });
          } else {
            conversations.set(args[0], row);
          }
          self.tables.set('conversations', conversations);
        } else if (sql.includes('INSERT INTO settings')) {
          const key = args[0];
          const value = args[1];
          const settings = getMap('settings');
          settings.set(key, { key, value });
          self.tables.set('settings', settings);
        } else if (sql.includes('DELETE FROM sessions')) {
          const sessions = getMap('sessions');
          sessions.delete(args[0]);
        } else if (sql.includes('DELETE FROM conversations')) {
          const conversations = getMap('conversations');
          conversations.delete(args[0]);
        } else if (sql.includes('INTO marketplaces')) {
          const table = getMap('marketplaces');
          table.set(args[0], { id: args[0], name: args[1], url: args[2], type: args[3] || 'github-repo', added_at: args[4] });
          self.tables.set('marketplaces', table);
        } else if (sql.includes('DELETE FROM marketplaces')) {
          const table = getMap('marketplaces');
          table.delete(args[0]);
        } else if (sql.includes('INTO installed_plugins')) {
          const table = getMap('installed_plugins');
          table.set(args[0], { name: args[0], description: args[1], system_prompt: args[2], source: args[3], installed_at: args[4], extra_data: args[5] || null });
          self.tables.set('installed_plugins', table);
        } else if (sql.includes('DELETE FROM installed_plugins')) {
          const table = getMap('installed_plugins');
          table.delete(args[0]);
        } else if (sql.includes('INSERT INTO plugin_errors')) {
          const table = getArr('plugin_errors');
          table.push({ id: Date.now(), plugin_name: args[0], marketplace: args[1], error: args[2], timestamp: args[3] });
          self.tables.set('plugin_errors', table);
        } else if (sql.includes('DELETE FROM plugin_errors')) {
          self.tables.set('plugin_errors', []);
        }
      },
      all: (...args: any[]) => {
        if (sql.includes('FROM sessions')) {
          const sessions = getMap('sessions');
          return Array.from(sessions.values()).sort((a: any, b: any) => (a.created_at || 0) - (b.created_at || 0));
        }
        if (sql.includes('FROM conversations')) {
          const conversations = getMap('conversations');
          return Array.from(conversations.values()).sort((a: any, b: any) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        }
        if (sql.includes('FROM settings')) {
          const key = args[0];
          const settings = getMap('settings');
          const row = settings.get(key);
          return row ? [row] : [];
        }
        if (sql.includes('FROM marketplaces')) {
          const table = getMap('marketplaces');
          return Array.from(table.values());
        }
        if (sql.includes('FROM installed_plugins')) {
          const table = getMap('installed_plugins');
          return Array.from(table.values()).sort((a: any, b: any) => b.installed_at - a.installed_at);
        }
        if (sql.includes('FROM plugin_errors')) {
          const table = getArr('plugin_errors');
          return table.sort((a: any, b: any) => b.timestamp - a.timestamp);
        }
        return [];
      },
      get: (...args: any[]) => {
        if (sql.includes('FROM settings')) {
          const key = args[0];
          const settings = getMap('settings');
          return settings.get(key) || null;
        }
        if (sql.includes('FROM installed_plugins')) {
          const key = args[0];
          const table = getMap('installed_plugins');
          return table.get(key) || null;
        }
        return null;
      },
    };
  }

  pragma(_sql: string) {}

  run(sql: string, params?: any[]) {
    this.prepare(sql).run(...(params || []));
  }

  all(sql: string, params?: any[]): any[] {
    return this.prepare(sql).all(...(params || []));
  }
}

export function getDb(): DbLike {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'deepseek-agent.db');
    const raw = new Database(dbPath);
    if (typeof raw.prepare !== 'function') {
      throw new Error('better-sqlite3 instance missing prepare');
    }
    (raw as any).pragma('journal_mode = WAL');
    // 封装为 DbLike，确保 run/all 始终可用（打包版可能丢失便捷方法）
    db = {
      exec: (sql: string) => raw.exec(sql),
      prepare: (sql: string) => raw.prepare(sql),
      pragma: (sql: string) => (raw as any).pragma(sql),
      run: (sql: string, params?: any[]) => raw.prepare(sql).run(...(params || [])),
      all: (sql: string, params?: any[]) => raw.prepare(sql).all(...(params || [])),
    };
    initSchema();
    runMigrations(db);
    console.log('[db] SQLite 持久化数据库已就绪:', dbPath);
    return db;
  } catch (err: any) {
    console.error('[db] better-sqlite3 加载失败，回退到内存数据库（重启后数据丢失）');
    console.error('[db] 错误原因:', err?.message || String(err));
    console.error('[db] 请运行: npx electron-rebuild -f -w better-sqlite3');
    db = new MemDb();
    initSchema();
    return db;
  }
}

export { getDb as getDatabase };

function initSchema() {
  db!.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      messages TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS marketplaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'github-repo',
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS installed_plugins (
      name TEXT PRIMARY KEY,
      description TEXT,
      system_prompt TEXT NOT NULL,
      source TEXT,
      installed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plugin_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_name TEXT,
      marketplace TEXT,
      error TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
}

function runMigrations(database: DbLike) {
  try {
    database.exec(`ALTER TABLE installed_plugins ADD COLUMN extra_data TEXT`);
  } catch {
    // 列已存在，忽略
  }
}
