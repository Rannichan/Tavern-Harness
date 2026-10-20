/**
 * 复制文本到剪贴板。
 *
 * 局域网 http 访问不是安全上下文，`navigator.clipboard` 不可用，
 * 此时退回已废弃但兼容性最好的 `document.execCommand('copy')`。
 *
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文 / 无权限：走下面的兜底
  }

  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(helper);
  helper.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  helper.remove();
  return copied;
}
