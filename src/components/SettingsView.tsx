import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import { PALETTES, type ThemeColor, type ThemeMode } from '../theme/theme';
import type { ApiProvider, ReasoningEffort } from '../types/models';
import { Icon } from './shared';

// ============================================================
// 设置视图（模型服务 / 超参数 / 主题 / 数据）
// ============================================================

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const providers = useStore((s) => s.providers);
  const refreshProviders = useStore((s) => s.refreshProviders);
  const addToast = useStore((s) => s.addToast);

  if (!settings) return null;

  // 数字滑杆——数值显示固定在行内，不溢出卡片
  const slider = (key: keyof typeof settings, min: number, max: number, step: number, fmt?: (v: number) => string) => (
    <label className="range-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onChange={(e) => setSettings({ [key]: parseFloat(e.target.value) })}
      />
      <span className="range-val">{fmt ? fmt(settings[key] as number) : (settings[key] as number)}</span>
    </label>
  );

  return (
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">设置</h2>
          <p className="view-sub">模型 API 配置、超参数、主题与数据管理</p>
        </div>

        {/* 生成参数 */}
        <div className="set-section" style={{ maxWidth: 620 }}>
          <h3>🎛 生成参数</h3>
          <table className="table param-table">
            <tbody>
              <tr>
                <td style={{ width: 170 }}>
                  <div className="s-label">Temperature</div>
                  <div className="s-desc">创造性与随机性</div>
                </td>
                <td>{slider('temperature', 0, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top P</div>
                  <div className="s-desc">核采样</div>
                </td>
                <td>{slider('topP', 0, 1, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top K</div>
                  <div className="s-desc">候选数量</div>
                </td>
                <td>{slider('topK', 0, 100, 1)}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Max Tokens</div>
                  <div className="s-desc">0 = 不限制</div>
                </td>
                <td>{slider('maxTokens', 0, 16384, 256)}</td>
              </tr>
              <tr>
                <td style={{ borderBottom: 'none' }}>
                  <div className="s-label">Reasoning Effort</div>
                  <div className="s-desc">思考强度</div>
                </td>
                <td style={{ borderBottom: 'none' }}>
                  <select
                    className="select"
                    value={settings.reasoningEffort}
                    onChange={(e) => setSettings({ reasoningEffort: e.target.value as ReasoningEffort })}
                  >
                    {['auto', 'off', 'low', 'medium', 'xhigh'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
          <hr className="sep" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="range-row">
              <span className="s-label" style={{ width: 130 }}>Frequency Penalty</span>
              {slider('frequencyPenalty', -2, 2, 0.05, (v) => v.toFixed(2))}
            </div>
            <div className="range-row">
              <span className="s-label" style={{ width: 130 }}>Presence Penalty</span>
              {slider('presencePenalty', -2, 2, 0.05, (v) => v.toFixed(2))}
            </div>
            <div className="range-row">
              <span className="s-label" style={{ width: 130 }}>Repetition Penalty</span>
              {slider('repetitionPenalty', 0.5, 2, 0.05, (v) => v.toFixed(2))}
            </div>
          </div>
        </div>

        {/* 模型服务 Provider */}
        <ProviderManager providers={providers} onChanged={refreshProviders} />

        <div className="set-grid">
          {/* 主题 */}
          <div className="set-section">
            <h3>🎨 主题</h3>
            <div className="field">
              <label>外观模式</label>
              <select
                className="select"
                value={settings.themeMode}
                onChange={(e) => setSettings({ themeMode: e.target.value as ThemeMode })}
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
            <div className="field">
              <label>主题色</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(Object.keys(PALETTES) as ThemeColor[]).map((c) => (
                  <button
                    key={c}
                    className={`theme-swatch ${settings.themeColor === c ? 'active' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${PALETTES[c].gradientFrom}, ${PALETTES[c].gradientTo})` }}
                    onClick={() => setSettings({ themeColor: c })}
                    title={PALETTES[c].name}
                  >
                    {settings.themeColor === c && '✓'}
                  </button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
              提示：可分别体验「紫罗兰 / 苍蓝 / 翡翠森林 / 赛博琥珀」四种氛围
            </p>
          </div>

          {/* 行为 */}
          <div className="set-section">
            <h3>⚙️ 行为</h3>
            <label className="check">
              <input type="checkbox" checked={settings.isStreaming} onChange={(e) => setSettings({ isStreaming: e.target.checked })} />
              流式输出
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.isThinkingModeEnabled} onChange={(e) => setSettings({ isThinkingModeEnabled: e.target.checked })} />
              思考模式（reasoning）
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.isToolCallsEnabled} onChange={(e) => setSettings({ isToolCallsEnabled: e.target.checked })} />
              工具调用（tools）
            </label>
          </div>
        </div>

        {/* 数据管理 */}
        <DangerZone />
      </div>
    </div>
  );
}

// ---------------- Providers ----------------

/** 依次尝试几个常见 models 端点，返回第一个成功的模型列表 */
async function fetchModelsSmart(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = [
    `${base}/models`,
    `${base}/v1/models`,
  ];
  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        lastErr = new Error(`HTTP ${resp.status}`);
        continue;
      }
      const json = (await resp.json()) as { data?: Array<{ id: string }> };
      const models = (json.data ?? []).map((m: { id: string }) => m.id).sort();
      if (models.length > 0) return models;
      lastErr = new Error('空模型列表');
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr ?? new Error('未知错误');
}

function ProviderManager({ providers, onChanged }: { providers: ApiProvider[]; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const [editing, setEditing] = useState<ApiProvider | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const toggleEnabled = async (p: ApiProvider) => {
    await db.providers.update(p.id!, { isEnabled: !p.isEnabled });
    onChanged();
    addToast(p.isEnabled ? `已停用「${p.name}」` : `已启用「${p.name}」`);
  };

  const testProvider = async (p: ApiProvider) => {
    setTestingId(p.id!);
    try {
      const models = await fetchModelsSmart(p.baseUrl, p.apiKey);
      await db.providers.update(p.id!, { cachedModelsCsv: models.join(',') });
      onChanged();
      addToast(`✅ 连通正常，拉取到 ${models.length} 个模型`);
    } catch (e) {
      const msg = (e as Error).message;
      // CORS 错误是浏览器端最常见原因，给出可操作的提示
      const isCors = /Failed to fetch|NetworkError|Load failed|TypeError/.test(msg);
      addToast(
        `❌ 连接失败: ${msg}${isCors ? '。疑似 CORS 跨域被拦截——若 API 服务未开放 CORS 头，可在开发模式下把 Base URL 改为 http://localhost:5173/api/<服务地址>/ 使用内置代理' : ''}`,
        'error'
      );
    } finally {
      setTestingId(null);
    }
  };

  const deleteProvider = async (p: ApiProvider) => {
    if (!confirm(`删除 Provider「${p.name}」？`)) return;
    await db.providers.delete(p.id!);
    onChanged();
    addToast('已删除 Provider');
  };

  return (
    <div className="set-section">
      <h3>🔌 模型服务 Provider（多端点）</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>还没有配置 Provider，点击下方按钮添加</div>}
        {providers.map((p) => (
          <div key={p.id} className={`provider-card ${p.isEnabled ? '' : 'disabled'}`}>
            <div className="p-head">
              {/* 启用开关放在卡片左侧最外面 */}
              <label className="switch" title={p.isEnabled ? '停用' : '启用'}>
                <input type="checkbox" checked={p.isEnabled} onChange={() => toggleEnabled(p)} />
                <span className="switch-slider" />
              </label>
              <span className="p-name">{p.name}</span>
              <span className={`p-status ${p.isEnabled ? 'on' : 'off'}`}>{p.isEnabled ? '启用' : '停用'}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" disabled={testingId === p.id} onClick={() => testProvider(p)}>
                  {testingId === p.id ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null}
                  {testingId === p.id ? '测试中' : '测试连接'}
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(p)}>编辑</button>
                <button className="btn btn-sm btn-danger" onClick={() => deleteProvider(p)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
            <div className="p-url">{p.baseUrl}</div>
            {p.cachedModelsCsv && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', maxHeight: 60, overflow: 'auto' }}>
                <b>模型：</b>
                {p.cachedModelsCsv.split(',').filter(Boolean).slice(0, 12).join(', ')}
                {p.cachedModelsCsv.split(',').filter(Boolean).length > 12 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ name: '', baseUrl: '', apiKey: '', isEnabled: true, cachedModelsCsv: '', fieldMappingsJson: '[]', createdAt: Date.now() })}>
          <Icon name="plus" size={13} /> 添加 Provider
        </button>
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal-root" onClick={(e) => e.stopPropagation()}>
            <div className="modal card">
              <div className="modal-head">
                <span style={{ fontWeight: 800, fontSize: 15 }}>{editing.id != null ? '编辑 Provider' : '添加 Provider'}</span>
                <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
              </div>
              <ProviderForm
                initial={editing}
                onSave={async (data) => {
                  if (editing.id != null) {
                    await db.providers.update(editing.id, data);
                    addToast('已更新 Provider');
                  } else {
                    await db.providers.add(data);
                    addToast('已添加 Provider');
                  }
                  setEditing(null);
                  onChanged();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderForm({ initial, onSave }: { initial: ApiProvider; onSave: (p: ApiProvider) => void }) {
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);

  return (
    <>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label>名称</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：DeepSeek 官方" />
        </div>
        <div className="field">
          <label>Base URL</label>
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1/ 或 http://192.168.x.x:8788/" />
        </div>
        <div className="field">
          <label>API Key</label>
          <input className="input mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </div>
        <label className="check">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
          启用该 Provider（默认模型选择器与聊天页模型列表会包含它）
        </label>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
          提示：若目标服务未开放 CORS（浏览器跨域被拦截），开发模式下可把 Base URL 写成
          <span className="mono" style={{ color: 'var(--text-dim)' }}> http://localhost:5173/api/192.168.50.175:8788/ </span>
          形式，由前端开发服务器代为转发（同源）。
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => {}} style={{ visibility: 'hidden' }}>取消</button>
        <button className="btn btn-primary" disabled={!name.trim() || !baseUrl.trim()} onClick={() => onSave({ ...initial, name: name.trim(), baseUrl: baseUrl.trim(), apiKey, isEnabled })}>保存</button>
      </div>
    </>
  );
}

// ---------------- 数据管理 ----------------

function DangerZone() {
  const addToast = useStore((s) => s.addToast);
  const refreshSessions = useStore((s) => s.refreshSessions);

  const clearAll = async () => {
    if (!confirm('确定清空所有数据？包括会话、角色、世界书、技能、统计。此操作不可恢复！')) return;
    await db.sessions.clear();
    await db.messages.clear();
    await db.participants.clear();
    await db.npcs.clear();
    await db.worldBooks.clear();
    await db.tools.clear();
    await db.tasks.clear();
    await db.careerStats.clear();
    await db.careerNpcStats.clear();
    // 重建种子
    await db.settings.put((await db.settings.get(1))!);
    await import('../db/database').then((m) => m.initDatabase());
    await refreshSessions();
    location.reload();
  };

  return (
    <div className="set-section" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)' }}>
      <h3>🗄 数据管理</h3>
      <div className="set-row">
        <div>
          <div className="s-label">导出当前会话</div>
          <div className="s-desc">将会话（含网络消息）导出为 JSON 文件</div>
        </div>
        <button className="btn btn-sm" onClick={exportCurrentSession}>导出</button>
      </div>
      <div className="set-row">
        <div>
          <div className="s-label" style={{ color: 'var(--danger)' }}>清空全部数据</div>
          <div className="s-desc">不可恢复，重建种子角色「酒馆老板」</div>
        </div>
        <button className="btn btn-sm btn-danger" onClick={clearAll}>清空</button>
      </div>
    </div>
  );
}

async function exportCurrentSession() {
  const sid = useStore.getState().activeSessionId;
  if (sid == null) return;
  const { exportSessionJson } = await import('../core/stats');
  await exportSessionJson(sid);
  useStore.getState().addToast('会话已导出');
}