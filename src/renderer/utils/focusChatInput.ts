/** 将焦点恢复到聊天输入框（避免 Electron 原生对话框抢焦点后无法输入） */
export function focusChatInput() {
  requestAnimationFrame(() => {
    if (document.querySelector('[data-focus-guard]')) return;
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[data-chat-input]'
    );
    if (!textarea) return;
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  });
}
