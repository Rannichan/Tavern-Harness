// ============================================================
// 文件下载（支持用户选择保存位置与文件名）
// 返回：'saved' 已保存到用户选择的位置；'downloaded' 已下载到默认目录；
//       'canceled' 用户取消（不产生任何文件）
// ============================================================

export type SaveResult = 'saved' | 'downloaded' | 'canceled';

async function pickSaveFileHandle(suggestedName: string): Promise<FileSystemFileHandle | 'canceled' | null> {
  // 仅在安全上下文（localhost / https）下可用
  if (typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker !== 'function') {
    return null;
  }
  try {
    return await (window as unknown as {
      showSaveFilePicker: (opts: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: 'Text Files',
          accept: { 'text/plain': ['.txt', '.json', '.md', '.csv', '.log'] },
        },
      ],
    });
  } catch (e) {
    // 用户主动取消（Esc / 点取消）→ 不产生任何文件
    if ((e as Error).name === 'AbortError') return 'canceled';
    // 其余异常（如浏览器不支持）→ 回退默认下载目录
    return null;
  }
}

/** 保存文本内容：优先调用系统「另存为」对话框让用户选择位置与文件名；
 *  不可用时回退为浏览器默认下载目录。用户取消时不产生任何文件。 */
export async function saveTextFile(content: string, mime: string, suggestedName: string): Promise<SaveResult> {
  const handle = await pickSaveFileHandle(suggestedName);
  if (handle === 'canceled') return 'canceled';
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'saved';
    } catch (e) {
      // 写入失败（如权限被拒）→ 回退默认下载
      console.warn('saveTextFile: File System Access API 写入失败，回退下载', e);
    }
  }
  // 回退：浏览器默认下载目录 + 建议文件名
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

/** 保存 JSON 对象为文件（便于各导出入口统一调用） */
export function saveJsonFile(payload: unknown, suggestedName: string): Promise<SaveResult> {
  return saveTextFile(JSON.stringify(payload, null, 2), 'application/json', suggestedName);
}