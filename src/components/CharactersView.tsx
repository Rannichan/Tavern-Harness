import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import type { NpcCharacter, WorldBook, McpTool } from '../types/models';
import { Avatar, Icon, Markdown } from './shared';
import { importSillyTavernCard } from '../core/sillyTavernImporter';

// ============================================================
// 角色工坊（NPC 管理 / 世界书 / 技能表 / PNG 导入）
// ============================================================

export function CharactersView() {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);
  const [tab, setTab] = useState<'characters' | 'worldbooks' | 'skills' | 'import'>('characters');
  const [editing, setEditing] = useState<NpcCharacter | null>(null);
  const [isNew, setIsNew] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useStore((s) => s.refreshNpcs);
  const refreshWb = useStore((s) => s.refreshWorldBooks);

  const handleImport = async (file: File) => {
    try {
      const result = await importSillyTavernCard(file);
      await refresh();
      addToast(
        `已导入角色卡「${result.characterName}」${result.worldBookName ? `＋ 世界书「${result.worldBookName}」` : ''} (${result.version})`
      );
    } catch (e) {
      addToast(`导入失败: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">角色工坊</h2>
          <p className="view-sub">管理 NPC、世界书与技能表，对标 SillyTavern 的角色卡流程</p>
        </div>
        <div className="side-nav">
          <button className={`nav-chip ${tab === 'characters' ? 'active' : ''}`} onClick={() => setTab('characters')}>
            👤 角色卡
          </button>
          <button className={`nav-chip ${tab === 'worldbooks' ? 'active' : ''}`} onClick={() => setTab('worldbooks')}>
            📖 世界书
          </button>
          <button className={`nav-chip ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>
            🛠 技能表
          </button>
          <button className={`nav-chip ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>
            📥 PNG 导入
          </button>
        </div>

        {tab === 'characters' && (
          <CharacterGrid
            npcs={npcs}
            onEdit={(n, isNew) => {
              setEditing(n);
              setIsNew(isNew);
            }}
          />
        )}
        {tab === 'worldbooks' && (
          <WorldBookList books={worldBooks} onChanged={refreshWb} />
        )}
        {tab === 'skills' && <SkillList onChanged={() => {}} />}
        {tab === 'import' && (
          <div>
            <div
              className="import-drop"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleImport(f);
              }}
            >
              <div style={{ fontSize: 30 }}>🃏</div>
              <div style={{ fontWeight: 700, marginTop: 6 }}>拖入或点击选择 SillyTavern PNG 角色卡</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                支持 chara V2（chara）与 V3（ccv3），自动解析人设、开场白与内嵌世界书
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {editing && (
        <CharacterEditorModal
          npc={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------- 角色网格 ----------------

function CharacterGrid({ npcs, onEdit }: { npcs: NpcCharacter[]; onEdit: (n: NpcCharacter, isNew: boolean) => void }) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    let cancelled = false;
    db.tools.toArray().then((t) => {
      if (!cancelled) setTools(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteNpc = async (n: NpcCharacter) => {
    if (n.isBuiltIn) {
      addToast('内置角色受保护，不可删除', 'error');
      return;
    }
    if (!confirm(`确定删除角色「${n.name}」？`)) return;
    await db.npcs.delete(n.id!);
    useStore.getState().refreshNpcs();
    addToast(`已删除角色「${n.name}」`);
  };

  const toggleSkill = async (n: NpcCharacter, skill: string) => {
    const enabled = new Set(n.enabledToolNames);
    if (enabled.has(skill)) enabled.delete(skill);
    else enabled.add(skill);
    await db.npcs.update(n.id!, { enabledToolNames: [...enabled] });
    useStore.getState().refreshNpcs();
  };

  const validSkills = new Set(tools.map((t) => t.name));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>角色卡（{npcs.length}）</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() =>
            onEdit(
              {
                name: '',
                prompt: '',
                greeting: '',
                avatarColorOrdinal: Math.floor(Math.random() * 6),
                avatarDataUrl: null,
                enabledToolNames: [],
                isBuiltIn: false,
                createdAt: Date.now(),
              },
              true
            )
          }
        >
          <Icon name="plus" size={13} /> 新建角色
        </button>
      </div>
      <div className="char-grid">
        {npcs.map((n) => (
          <div key={n.id} className="char-card fade-up">
            <div className="cname">
              <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
              {n.name}
              {n.isBuiltIn && <span className="tag">内置</span>}
            </div>
            <div className="cgreet">{n.greeting || '（无开场白）'}</div>
            {n.enabledToolNames.length > 0 && (
              <div className="cskil">
                {n.enabledToolNames.map((s) => (
                  <span key={s} className="skill-tag">{s}</span>
                ))}
              </div>
            )}
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => onEdit(n, false)}><Icon name="settings" size={12} /> 编辑</button>
              <button className="btn btn-sm btn-danger" onClick={() => deleteNpc(n)} disabled={n.isBuiltIn} title={n.isBuiltIn ? '内置角色受保护' : '删除'}>
                <Icon name="trash" size={12} />
              </button>
            </div>
            <details style={{ fontSize: 11.5 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-faint)' }}>启用技能（{n.enabledToolNames.filter((s) => validSkills.has(s)).length}/{tools.length}）</summary>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {tools.map((t) => (
                  <label key={t.name} className={`skill-tag ${n.enabledToolNames.includes(t.name) ? '' : 'locked'}`} style={{ cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={n.enabledToolNames.includes(t.name)} onChange={() => toggleSkill(n, t.name)} style={{ accentColor: 'var(--primary)' }} />
                    {t.name}
                  </label>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- 角色编辑器 ----------------

function CharacterEditorModal({ npc, isNew, onClose, onSaved }: { npc: NpcCharacter; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(npc.name);
  const [prompt, setPrompt] = useState(npc.prompt);
  const [greeting, setGreeting] = useState(npc.greeting);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(npc.avatarDataUrl ?? null);
  const addToast = useStore((s) => s.addToast);

  const save = async () => {
    if (!name.trim()) {
      addToast('名称不能为空', 'error');
      return;
    }
    const data: Partial<NpcCharacter> = { name: name.trim(), prompt, greeting, avatarDataUrl };
    if (isNew) {
      await db.npcs.add({
        ...npc,
        name: name.trim(),
        prompt,
        greeting,
        avatarDataUrl,
      });
      addToast(`已创建角色「${name}」`);
    } else {
      await db.npcs.update(npc.id!, data);
      addToast(`已更新角色「${name}」`);
    }
    onSaved();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>{isNew ? '新建角色' : `编辑角色 · ${npc.name}`}</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Avatar name={name || '角色'} colorOrdinal={npc.avatarColorOrdinal} imageUrl={avatarDataUrl} size="sm" />
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer', position: 'relative' }}>
                  上传头像
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const reader = new FileReader();
                      reader.onload = () => setAvatarDataUrl(reader.result as string);
                      reader.readAsDataURL(f);
                    }
                  }} />
                </label>
                {avatarDataUrl && <button className="btn btn-sm btn-ghost" onClick={() => setAvatarDataUrl(null)}>清除</button>}
              </div>
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名" />
            </div>
            <div className="field">
              <label>人设 Prompt（注入 system prompt）</label>
              <textarea className="textarea" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：神秘的酒馆老板，可以响应客人的任何需求" />
            </div>
            <div className="field">
              <label>开场白 Greeting</label>
              <textarea className="textarea" rows={2} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="你来啦！快坐下~" />
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- 世界书 ----------------

function WorldBookList({ books, onChanged }: { books: WorldBook[]; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const [editing, setEditing] = useState<WorldBook | { name: ''; content: ''; imageUri: null; createdAt: number } | null>(null);

  const saveWb = async (name: string, content: string) => {
    if (!name.trim() || !content.trim()) {
      addToast('世界书名与内容不能为空', 'error');
      return;
    }
    if (editing && 'id' in editing && editing.id != null) {
      await db.worldBooks.update(editing.id, { name: name.trim(), content });
      addToast('已更新世界书');
    } else {
      await db.worldBooks.add({ name: name.trim(), content, imageUri: null, createdAt: Date.now() });
      addToast('已创建世界书');
    }
    setEditing(null);
    onChanged();
  };

  const deleteWb = async (b: WorldBook) => {
    if (!confirm(`确定删除世界书「${b.name}」？`)) return;
    await db.worldBooks.delete(b.id!);
    addToast('已删除世界书');
    onChanged();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>世界书（{books.length}）</span>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', content: '', imageUri: null, createdAt: Date.now() })}>
          <Icon name="plus" size={13} /> 新建世界书
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {books.length === 0 && <div className="empty-state"><div className="big">📖</div>暂无世界书，为角色建立世界观吧</div>}
        {books.map((b) => (
          <div key={b.id} className="list-item">
            <div style={{ fontSize: 20 }}>📖</div>
            <div className="l-main">
              <div className="l-title">{b.name}</div>
              <div className="l-sub">{b.content.slice(0, 60)}…</div>
            </div>
            <button className="btn btn-sm" onClick={() => setEditing(b)}>浏览/编辑</button>
            <button className="btn btn-sm btn-danger" onClick={() => deleteWb(b)}><Icon name="trash" size={12} /></button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal-root" onClick={(e) => e.stopPropagation()}>
            <div className="modal card">
              <div className="modal-head">
                <span style={{ fontWeight: 800, fontSize: 15 }}>{'id' in editing && editing.id != null ? `编辑世界书` : '新建世界书'}</span>
                <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
              </div>
              <WorldBookForm initial={editing} onSave={saveWb} onCancel={() => setEditing(null)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorldBookForm({ initial, onSave, onCancel }: { initial: WorldBook | { name: string; content: string; imageUri: null; createdAt: number }; onSave: (n: string, c: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  return (
    <>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label>世界书名</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：北境大陆" />
        </div>
        <div className="field">
          <label>内容（附加在角色人设之后）</label>
          <textarea className="textarea" rows={9} value={content} onChange={(e) => setContent(e.target.value)} placeholder="世界观设定文本…" />
        </div>
        {content && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            预览（Markdown 渲染）：
            <div className="bubble" style={{ marginTop: 6, padding: '10px 14px', fontSize: 13 }}>
              <Markdown text={content.slice(0, 400)} />
            </div>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => onSave(name, content)}>保存</button>
      </div>
    </>
  );
}

// ---------------- 技能表 ----------------

function SkillList({ onChanged }: { onChanged: () => void }) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const addToast = useStore((s) => s.addToast);
  const refresh = async () => {
    setTools(await db.tools.toArray());
    onChanged();
  };
  useEffect(() => {
    refresh();
  }, []);

  const deleteTool = async (t: McpTool) => {
    if (t.isBuiltIn) {
      addToast('内置技能受保护，不可删除', 'error');
      return;
    }
    if (!confirm(`确定删除技能「${t.name}」？`)) return;
    await db.tools.delete(t.id!);
    await refresh();
    addToast('已删除技能');
  };

  return (
    <div>
      <span className="group-label">技能表（{tools.length}）</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tools.map((t) => {
          let desc = '';
          try {
            desc = (JSON.parse(t.jsonContent) as { function?: { description?: string } }).function?.description ?? '';
          } catch { /* ignore */ }
          let impl = 'native';
          if (t.executionJson) {
            try {
              impl = (JSON.parse(t.executionJson) as { type?: string }).type ?? 'invalid';
            } catch { impl = 'invalid'; }
          }
          return (
            <div key={t.id} className="list-item">
              <div style={{ fontSize: 18 }}>{t.isBuiltIn ? '🧰' : '⚙️'}</div>
              <div className="l-main">
                <div className="l-title">
                  {t.name}
                  {t.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>内置</span>}
                </div>
                <div className="l-sub">{desc}</div>
                {impl !== 'native' && <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--warn)' }}>实现类型: {impl}</div>}
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => deleteTool(t)} disabled={t.isBuiltIn}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          );
        })}
        {tools.length === 0 && <div className="empty-state"><div className="big">🛠</div>暂无技能</div>}
      </div>
    </div>
  );
}