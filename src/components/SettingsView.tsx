import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import { PALETTES, type ThemeColor, type ThemeMode } from '../theme/theme';
import type { ApiProvider, AppLanguage, ReasoningEffort } from '../types/models';
import { Icon } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { isProxyUrl, isNetworkLikeError, toProxyUrl } from '../core/proxy';
import { useT } from '../core/i18n';

// ============================================================
// 设置视图（模型服务 / 超参数 / 主题）
// ============================================================

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const providers = useStore((s) => s.providers);
  const refreshProviders = useStore((s) => s.refreshProviders);
  const t = useT();

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
          <h2 className="view-title">{t('settings.title')}</h2>
          <p className="view-sub">{t('settings.sub')}</p>
        </div>

        {/* 模型服务 Provider（置顶） */}
        <ProviderManager providers={providers} onChanged={refreshProviders} />

        {/* 生成参数 */}
        <div className="set-section">
          <h3>{t('settings.genParams')}</h3>
          <table className="table param-table">
            <tbody>
              <tr>
                <td style={{ width: 170 }}>
                  <div className="s-label">Temperature</div>
                  <div className="s-desc">{t('settings.tempDesc')}</div>
                </td>
                <td>{slider('temperature', 0, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top P</div>
                  <div className="s-desc">{t('settings.topPDesc')}</div>
                </td>
                <td>{slider('topP', 0, 1, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top K</div>
                  <div className="s-desc">{t('settings.topKDesc')}</div>
                </td>
                <td>{slider('topK', 0, 100, 1)}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Max Tokens</div>
                  <div className="s-desc">{t('settings.maxTokensDesc')}</div>
                </td>
                <td>{slider('maxTokens', 0, 16384, 256)}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Frequency Penalty</div>
                  <div className="s-desc">{t('settings.freqDesc')}</div>
                </td>
                <td>{slider('frequencyPenalty', -2, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Presence Penalty</div>
                  <div className="s-desc">{t('settings.presDesc')}</div>
                </td>
                <td>{slider('presencePenalty', -2, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td style={{ borderBottom: 'none' }}>
                  <div className="s-label">Repetition Penalty</div>
                  <div className="s-desc">{t('settings.repDesc')}</div>
                </td>
                <td style={{ borderBottom: 'none' }}>{slider('repetitionPenalty', 0.5, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td style={{ borderBottom: 'none' }}>
                  <div className="s-label">Reasoning Effort</div>
                  <div className="s-desc">{t('settings.effortDesc')}</div>
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
        </div>

        <div className="set-grid">
          {/* 界面语言 */}
          <div className="set-section">
            <h3>{t('settings.language')}</h3>
            <div className="field">
              <label>{t('settings.languageLabel')}</label>
              <select
                className="select"
                value={settings.language ?? ''}
                onChange={(e) => setSettings({ language: (e.target.value || null) as AppLanguage })}
              >
                <option value="">{t('settings.followBrowser')}</option>
                <option value="zh-CN">简体中文</option>
                <option value="zh-TW">繁體中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
              {t('settings.followBrowser')}
            </p>
          </div>

          {/* 主题 */}
          <div className="set-section">
            <h3>{t('settings.theme')}</h3>
            <div className="field">
              <label>{t('settings.appearance')}</label>
              <select
                className="select"
                value={settings.themeMode}
                onChange={(e) => setSettings({ themeMode: e.target.value as ThemeMode })}
              >
                <option value="system">{t('settings.system')}</option>
                <option value="light">{t('settings.light')}</option>
                <option value="dark">{t('settings.dark')}</option>
              </select>
            </div>
            <div className="field">
              <label>{t('settings.themeColor')}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(Object.keys(PALETTES) as ThemeColor[]).map((c) => (
                  <button
                    key={c}
                    className={`theme-swatch ${settings.themeColor === c ? 'active' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${PALETTES[c].gradientFrom}, ${PALETTES[c].gradientTo})` }}
                    onClick={() => setSettings({ themeColor: c })}
                    title={t(`theme.${c}`)}
                  >
                    {settings.themeColor === c && '✓'}
                  </button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
              {t('settings.themeTip')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Providers ----------------

interface ModelsResult {
  models: string[];
  viaProxy: boolean;
}

/** 依次尝试常见 models 端点，返回第一个成功的模型列表。
 *  若直连请求被 CORS 拦截，自动回退到开发服务器同源代理（若可用）。 */
async function fetchModelsSmart(baseUrl: string, apiKey: string): Promise<ModelsResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = [`${base}/models`, `${base}/v1/models`];

  // 收集“网络层失败”的次数：若直连失败且存在可用的代理 URL → 自动重试代理
  const proxyUrl = toProxyUrl(baseUrl);

  let lastErr: Error | null = null;
  let viaProxy = false;

  const tryFetch = async (url: string): Promise<string[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const resp = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as { data?: Array<{ id: string }> };
      const models = (json.data ?? []).map((m: { id: string }) => m.id).sort();
      if (models.length === 0) throw new Error('empty-model-list');
      return models;
    } finally {
      clearTimeout(timer);
    }
  };

  // 第 1 轮：直连
  for (const url of candidates) {
    try {
      return { models: await tryFetch(url), viaProxy: false };
    } catch (e) {
      lastErr = e as Error;
    }
  }

  // 第 2 轮：CORS/网络失败 → 代理回退
  if (proxyUrl && isNetworkLikeError(lastErr)) {
    const proxiedCandidates = [`${proxyUrl}/models`, `${proxyUrl}/v1/models`];
    for (const url of proxiedCandidates) {
      try {
        const models = await tryFetch(url);
        return { models, viaProxy: !!proxyUrl };
      } catch (e) {
        lastErr = e as Error;
      }
    }
  }

  throw lastErr ?? new Error('unknown-error');
}

function ProviderManager({ providers, onChanged }: { providers: ApiProvider[]; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<ApiProvider | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiProvider | null>(null);

  const toggleEnabled = async (p: ApiProvider) => {
    await db.providers.update(p.id!, { isEnabled: !p.isEnabled });
    onChanged();
    addToast(p.isEnabled ? t('toast.providerDisabled', { name: p.name }) : t('toast.providerEnabled', { name: p.name }));
  };

  const testProvider = async (p: ApiProvider) => {
    setTestingId(p.id!);
    try {
      const { models, viaProxy } = await fetchModelsSmart(p.baseUrl, p.apiKey);
      await db.providers.update(p.id!, { cachedModelsCsv: models.join(',') });
      onChanged();
      // 自动把直连 Base URL 修正为代理 URL（若可用且当前不是代理形式）
      if (viaProxy && !isProxyUrl(p.baseUrl)) {
        const proxy = toProxyUrl(p.baseUrl);
        if (proxy) await db.providers.update(p.id!, { baseUrl: proxy });
        onChanged();
      }
      addToast(t('toast.providerOk', { n: models.length, via: viaProxy ? t('toast.providerViaProxy') : '' }));
    } catch (e) {
      const msg = (e as Error).message;
      // CORS 错误是浏览器端最常见原因，给出可操作的提示
      const isCors = isNetworkLikeError(e);
      addToast(
        t('toast.providerFail', { msg, hint: isCors ? t('toast.providerFailCors') : '' }),
        'error'
      );
    } finally {
      setTestingId(null);
    }
  };

  const deleteProvider = async (p: ApiProvider) => {
    await db.providers.delete(p.id!);
    onChanged();
    addToast(t('toast.providerDeleted'));
  };

  return (
    <div className="set-section">
      <h3>{t('settings.providerTitle')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>{t('settings.noProvider')}</div>}
        {providers.map((p) => (
          <div key={p.id} className={`provider-card ${p.isEnabled ? '' : 'disabled'}`}>
            <div className="p-head">
              {/* 启用开关放在卡片左侧最外面 */}
              <label className="switch" title={p.isEnabled ? t('settings.disable') : t('settings.enable')}>
                <input type="checkbox" checked={p.isEnabled} onChange={() => toggleEnabled(p)} />
                <span className="switch-slider" />
              </label>
              <span className="p-name">{p.name}</span>
              <span className={`p-status ${p.isEnabled ? 'on' : 'off'}`}>{p.isEnabled ? t('settings.enable') : t('settings.disable')}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" disabled={testingId === p.id} onClick={() => testProvider(p)}>
                  {testingId === p.id ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null}
                  {testingId === p.id ? t('settings.testing') : t('settings.test')}
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(p)}>{t('common.edit')}</button>
                <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(p)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
            <div className="p-url">{p.baseUrl}</div>
            {p.cachedModelsCsv && (
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)', maxHeight: 60, overflow: 'auto' }}>
                <b>{t('settings.models')}</b>
                {p.cachedModelsCsv.split(',').filter(Boolean).slice(0, 12).join(', ')}
                {p.cachedModelsCsv.split(',').filter(Boolean).length > 12 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ name: '', baseUrl: '', apiKey: '', isEnabled: true, cachedModelsCsv: '', fieldMappingsJson: '[]', createdAt: Date.now() })}>
          <Icon name="plus" size={13} /> {t('settings.addProvider')}
        </button>
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal-root" onClick={(e) => e.stopPropagation()}>
            <div className="modal card">
              <div className="modal-head">
                <span style={{ fontWeight: 800, fontSize: 15 }}>{editing.id != null ? t('settings.editProvider') : t('settings.addProvider')}</span>
                <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
              </div>
              <ProviderForm
                initial={editing}
                onSave={async (data) => {
                  if (editing.id != null) {
                    await db.providers.update(editing.id, data);
                    addToast(t('toast.providerUpdated'));
                  } else {
                    await db.providers.add(data);
                    addToast(t('toast.providerAdded'));
                  }
                  setEditing(null);
                  onChanged();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('settings.deleteProvider')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteProvider(pendingDelete)}
        />
      )}
    </div>
  );
}

function ProviderForm({ initial, onSave }: { initial: ApiProvider; onSave: (p: ApiProvider) => void }) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);

  return (
    <>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label>{t('settings.providerName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providerNamePh')} />
        </div>
        <div className="field">
          <label>{t('settings.baseUrl')}</label>
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.baseUrlPh')} />
        </div>
        <div className="field">
          <label>{t('settings.apiKey')}</label>
          <input className="input mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t('settings.apiKeyPh')} />
        </div>
        <label className="check">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} />
          {t('settings.enableProvider')}
        </label>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
          {t('settings.corsTip')}
          <span className="mono" style={{ color: 'var(--text-dim)' }}>{t('settings.corsTipPath')}</span>
          {t('settings.corsTipEnd')}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => {}} style={{ visibility: 'hidden' }}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!name.trim() || !baseUrl.trim()} onClick={() => onSave({ ...initial, name: name.trim(), baseUrl: baseUrl.trim(), apiKey, isEnabled })}>{t('common.save')}</button>
      </div>
    </>
  );
}

