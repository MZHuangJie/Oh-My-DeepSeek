import React, { useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import { useThemeStore } from '../../stores/theme';

try {
  loader.config({ paths: { vs: './vs' } });
} catch (e) {
  console.error('[Monaco Diff] loader.config failed:', e);
}

interface Props {
  original: string;
  modified: string;
  language: string;
  originalLabel?: string;
  modifiedLabel?: string;
  height?: string;
  inline?: boolean;
  fill?: boolean;
}

export default function DiffView({
  original,
  modified,
  language,
  originalLabel,
  modifiedLabel,
  height = '240px',
  inline = false,
  fill = false,
}: Props) {
  const [monacoError, setMonacoError] = useState<string | null>(null);

  React.useEffect(() => {
    loader.init().catch((err) => {
      console.error('[Monaco Diff] failed to load:', err);
      setMonacoError(err ? (err.stack || err.message || String(err)) : '未知错误');
    });
  }, []);

  if (monacoError) {
    return (
      <div style={{ padding: 8, fontSize: 11, color: '#f87171', background: '#0f0f18' }}>
        Diff 编辑器加载失败: {monacoError}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: fill ? '100%' : height,
      minHeight: fill ? 0 : height,
      flex: fill ? 1 : undefined,
    }}>
      {(originalLabel || modifiedLabel) && (
        <div style={{
          display: 'flex',
          fontSize: 10,
          color: '#8888aa',
          background: '#12121c',
          borderBottom: '1px solid #2a2a3a',
        }}>
          <span style={{ flex: 1, padding: '4px 8px' }}>{originalLabel || 'Original'}</span>
          <span style={{ flex: 1, padding: '4px 8px', borderLeft: '1px solid #2a2a3a' }}>{modifiedLabel || 'Modified'}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffEditor
          original={original}
          modified={modified}
          language={language}
          theme={(() => { const p = useThemeStore(s => s.areas.editor?.preset || s.globalPreset); return p === 'dark' || p === 'dark-hc' ? 'vs-dark' : 'vs'; })()}
          loading={<div style={{ padding: 8, fontSize: 11, color: '#8888aa' }}>加载 Diff…</div>}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            automaticLayout: true,
            renderSideBySide: !inline,
            enableSplitViewResizing: true,
            ignoreTrimWhitespace: false,
            scrollBeyondLastLine: false,
            renderOverviewRuler: true,
            lineNumbers: 'on',
            folding: false,
            diffAlgorithm: 'advanced',
          }}
          height="100%"
        />
      </div>
    </div>
  );
}
