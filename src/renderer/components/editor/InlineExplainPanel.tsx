import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { useModelStore } from '../../stores/model';
import styles from './InlineExplainPanel.module.css';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  code: string;
  language: string;
  filePath: string;
  startLine: number;
  endLine: number;
  onClose: () => void;
}

export default function InlineExplainPanel({ code, language, filePath, startLine, endLine, onClose }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const runQuery = useCallback(async (prompt: string) => {
    const modelConfig = useModelStore.getState().getActiveModel();
    const apiKey = modelConfig.apiKey || await window.api.settings.getApiKey();
    if (!apiKey) return;

    setMessages(prev => [...prev, { role: 'user', content: prompt }]);
    setStreaming(true);
    setStreamText('');

    const unsubDone = window.api.explain.onDone(() => {
      setStreaming(false);
      setStreamText(prev => {
        setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
        return '';
      });
      unsubDone();
    });

    const unsubChunk = window.api.explain.onChunk((text) => {
      setStreamText(prev => prev + text);
    });

    window.api.explain.send({
      apiKey,
      model: modelConfig.model,
      baseUrl: modelConfig.baseUrl,
      messages: [
        { role: 'user', content: prompt },
      ],
    }).catch(() => {
      setStreaming(false);
      unsubChunk();
      unsubDone();
    });
  }, []);

  // 首次打开自动发送解释请求
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const prompt = `解释以下 ${language} 代码（文件: ${filePath.split(/[\\/]/).pop()}, 第 ${startLine === endLine ? startLine : `${startLine}-${endLine}`} 行）：\n\`\`\`${language}\n${code}\n\`\`\``;
    void runQuery(prompt);
  }, []); // eslint-disable-line

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamText]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    setInput('');
    void runQuery(trimmed);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          代码解释 — {filePath.split(/[\\/]/).pop()} L{startLine}{startLine !== endLine ? `-L${endLine}` : ''}
        </span>
        <button onClick={onClose} className={styles.closeBtn}>✕</button>
      </div>

      <div className={styles.messages} ref={listRef}>
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <div className={styles.msgRole}>{msg.role === 'user' ? '你' : 'AI'}</div>
            <div className={styles.msgContent}>
              {msg.role === 'assistant'
                ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                : msg.content}
            </div>
          </div>
        ))}
        {streaming && streamText && (
          <div className={styles.assistantMsg}>
            <div className={styles.msgRole}>AI</div>
            <div className={styles.msgContent}><ReactMarkdown>{streamText}</ReactMarkdown></div>
          </div>
        )}
        {streaming && !streamText && (
          <div className={styles.assistantMsg}>
            <div className={styles.msgRole}>AI</div>
            <div className={styles.msgContent}><span className={styles.typing}>思考中...</span></div>
          </div>
        )}
      </div>

      <div className={styles.inputRow}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="追问代码相关问题..."
          disabled={streaming}
          className={styles.input}
          spellCheck={false}
        />
        <button onClick={handleSend} disabled={streaming || !input.trim()} className={styles.sendBtn}>发送</button>
      </div>
    </div>
  );
}
