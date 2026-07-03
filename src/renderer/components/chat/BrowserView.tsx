import React, { useState, useRef, useEffect, useCallback } from 'react';
import shared from '../../styles/components.module.css';
import styles from './BrowserView.module.css';

interface Props {
  initialUrl?: string;
}

export default function BrowserView({ initialUrl }: Props) {
  const [url, setUrl] = useState(initialUrl || 'https://www.baidu.com');
  const [inputUrl, setInputUrl] = useState(initialUrl || 'https://www.baidu.com');
  const [sending, setSending] = useState(false);
  const webviewRef = useRef<any>(null);

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      setInputUrl(initialUrl);
    }
  }, [initialUrl]);

  const navigate = () => {
    const u = inputUrl.trim();
    if (!u) return;
    const fullUrl = u.startsWith('http') ? u : `https://${u}`;
    setUrl(fullUrl);
    setInputUrl(fullUrl);
  };

  const goBack = () => webviewRef.current?.goBack();
  const goForward = () => webviewRef.current?.goForward();
  const reload = () => webviewRef.current?.reload();

  const sendPageToAI = useCallback(async () => {
    const wv = webviewRef.current;
    if (!wv) return;
    setSending(true);
    try {
      const pageUrl = (await wv.executeJavaScript('location.href')) as string;
      const pageTitle = (await wv.executeJavaScript('document.title')) as string;
      const pageText = (await wv.executeJavaScript(`
        (function() {
          document.querySelectorAll('script, style, nav, footer, header, aside').forEach(e => e.remove());
          return document.body?.innerText || document.documentElement?.innerText || '';
        })()
      `)) as string;
      const msg = `请分析以下网页内容：\nURL: ${pageUrl}\n标题: ${pageTitle}\n\n${pageText.slice(0, 5000)}`;
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]');
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, msg);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
      }
    } catch {}
    setSending(false);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <NavBtn onClick={goBack} title="后退">◀</NavBtn>
        <NavBtn onClick={goForward} title="前进">▶</NavBtn>
        <NavBtn onClick={reload} title="刷新">↻</NavBtn>
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
          placeholder="输入网址..."
          spellCheck={false}
          className={styles.urlInput}
        />
        <NavBtn onClick={sendPageToAI} title="将当前页面内容发送给 AI">
          {sending ? '...' : '📤'}
        </NavBtn>
      </div>
      <webview ref={webviewRef} src={url} className={styles.webview} />
    </div>
  );
}

function NavBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} className={shared.toolbarBtn} style={{ padding: '4px 9px', fontSize: 11 }}>{children}</button>;
}
