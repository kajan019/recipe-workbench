/* ===================================================================
 * WorkBuddy 工作台 · 菜谱专区 (首期)
 * 纯前端实现，数据存于 localStorage，无需后端。
 * =================================================================== */

/* ---------------- 常量 ---------------- */
const STORE_KEY = 'wb_recipe_workbench_v1';

const CATEGORY_TAGS = ['禽类', '畜类', '鱼类', '其他水产', '素菜', '主食类', '其他'];
const COOKING_TAGS  = ['炒', '煎炸', '煮', '炖', '蒸', '烤'];

const SECTIONS = [
  { key: 'ingredients', title: '食材',     kindLabel: '食材',   structured: true },
  { key: 'seasonings',  title: '调味料',   kindLabel: '调味料', structured: true },
  { key: 'prep',        title: '备菜',     kindLabel: '备菜',   structured: false, custom: true },
  { key: 'steps',       title: '烹饪步骤', kindLabel: '步骤',   structured: false },
];

const UNIT_OPTIONS = ['', 'g', 'ml', '铁勺', '瓷勺', '茶勺'];
const SEASONING_SUGGESTIONS = ['盐', '生抽', '老抽', '醋', '白糖', '料酒', '蚝油', '胡椒粉', '食用油', '鸡精', '豆瓣酱', '蒜', '姜', '葱', '淀粉', '辣椒'];

/* ---------------- 工具 ---------------- */
const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = (id) => document.getElementById(id);

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/[，,。.\/、]/g, ''); }

function blankRecipe() {
  return {
    id: uid(), name: '', cover: null,
    categories: [], cookings: [],
    sections: { ingredients: [], seasonings: [], prep: [], steps: [] },
    scaleBase: null, scaleAmount: null,
    videoUrl: '',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}
function blankItem() { return { id: uid(), kind: 'item', name: '', amount: null, unit: '', text: '', images: [] }; }
function blankNote() { return { id: uid(), kind: 'note', text: '', images: [] }; }
function syncText(b) { b.text = [b.name || '', (b.amount != null ? b.amount : '') + (b.unit || '')].filter(Boolean).join(' ').trim() || b.text; }

/* ---------------- 分量（按比例缩放） ----------------
 * 以「食材」中某一项为基准量：选定基准食材并输入其目标用量后，
 * 整道菜（食材/调味料/来源用量的备菜）按 base.amount → scaleAmount 比例缩放。
 * 用量为空（适量）的项保持「适量」不缩放。 */
function baseIngredientOptions(r) {
  return (r.sections.ingredients || []).filter(b => b.kind === 'item' && b.amount != null && b.amount !== 0);
}
function scaleFactorOf(r) {
  if (!r.scaleBase || r.scaleAmount == null || r.scaleAmount === '') return 1;
  const base = (r.sections.ingredients || []).find(b => b.id === r.scaleBase && b.kind === 'item');
  if (!base || base.amount == null || base.amount === 0) return 1;
  return r.scaleAmount / base.amount;
}
function scaleAmt(orig, factor) {
  if (orig == null || isNaN(orig)) return null;        // 适量
  if (factor === 1) return orig;
  return Math.round(orig * factor * 100) / 100;
}
/* 分量控件：prefix 区分查看页('portion')与采购页('p-portion') */
function portionControlHTML(r, prefix) {
  const opts = baseIngredientOptions(r);
  if (!opts.length) return '';
  const baseId = (r.scaleBase && opts.some(o => o.id === r.scaleBase)) ? r.scaleBase : opts[0].id;
  const base = opts.find(o => o.id === baseId);
  const optHTML = opts.map(o =>
    `<option value="${escAttr(o.id)}" ${o.id === baseId ? 'selected' : ''}>${escHtml(o.name)} ${o.amount}${escHtml(o.unit || '')}</option>`).join('');
  const factor = (r.scaleBase && r.scaleAmount != null) ? scaleFactorOf(r) : null;
  return `
    <div class="portion-box">
      <span class="portion-label">分量</span>
      <select class="portion-base" data-action="${prefix}-base" data-id="${escAttr(r.id)}">${optHTML}</select>
      <span class="portion-eq">→</span>
      <input class="portion-amt" type="number" step="any" min="0" data-action="${prefix}-amt" data-id="${escAttr(r.id)}" value="${r.scaleAmount != null ? r.scaleAmount : ''}" placeholder="${base.amount}">
      <button class="btn sm primary" data-action="${prefix}-confirm" data-id="${escAttr(r.id)}">确认</button>
      <button class="tiny" data-action="${prefix}-reset" data-id="${escAttr(r.id)}" title="恢复原始用量">重置</button>
      ${factor != null ? `<span class="portion-eq">已按 ${escHtml(factor)}× 调整</span>` : ''}
    </div>`;
}

/* 图片压缩：缩放到 maxDim 以内并以 jpeg 重编码 */
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function pickFiles({ multiple = true, capture = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', 'environment');
    inp.onchange = () => resolve(inp.files);
    inp.click();
  });
}

/* 用量解析：从自由文本中提取 名称 / 数量 / 单位 */
const UNIT_LIST = ['公斤', 'kg', 'KG', '斤', '克', 'g', 'G', '毫升', 'ml', 'ML', 'mL', '升', 'L', 'l', '颗', '个', '只', '根', '片', '把', '块', '勺', '汤匙', '茶匙', '适量'];
const UNIT_ALIAS = { '克': 'g', 'g': 'g', 'G': 'g', '毫升': 'ml', 'ml': 'ml', 'ML': 'ml', 'mL': 'ml', '升': 'L', 'l': 'L', 'L': 'L', '颗': '颗', '个': '个', '只': '个', '根': '根', '片': '片', '把': '把', '块': '块', '勺': '勺', '铁勺': '铁勺', '瓷勺': '瓷勺', '茶勺': '茶勺', '汤匙': '瓷勺', '茶匙': '茶勺', '公斤': 'kg', 'kg': 'kg', 'KG': 'kg', '斤': '斤', '适量': '适量' };
function parseMaterial(text) {
  if (!text) return { name: '', qty: null, unit: '' };
  const t = text.trim();
  const re = new RegExp('(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_LIST.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')');
  const m = t.match(re);
  if (m) {
    const qty = parseFloat(m[1]);
    const unit = UNIT_ALIAS[m[2]] || m[2];
    const name = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
    return { name: name || t, qty, unit };
  }
  return { name: t, qty: null, unit: '' };
}
/* ---------------- 收藏夹：原文解析 + 转换 ---------------- */
function stripStepNo(s) {
  return s.replace(/^(?:步骤?\s*)?\d+\s*[\.、)】:]?\s*/i, '')
          .replace(/^[①-⑩]\s*/, '').trim();
}
/* 常见调料关键词：无分段标题时，用来把「调料」从「食材」中区分出来 */
const SEASONING_KEYWORDS = ['盐','生抽','老抽','酱油','醋','白糖','冰糖','红糖','料酒','蚝油','胡椒粉','胡椒','淀粉','辣椒','蒜','姜','葱','食用油','油','鸡精','豆瓣酱','番茄酱','蕃茄酱','芝麻油','香油','花椒','八角','桂皮','香叶','五香粉','孜然','芥末','沙拉酱','花生酱','黄豆酱','甜面酱','柱侯酱','咖喱','味精','黑胡椒','白胡椒','椒盐','豉油','蒸鱼豉油','陈醋','米醋','香醋','辣酱','剁椒','泡椒','十三香','蚝','麻油'];
/* 去掉行首的括号/符号/emoji，便于识别带【】🥬等前缀的段标题 */
function stripSymbols(s) {
  return s.replace(/^[\s\[\]【】()（）「」『』·•*、\-—~～]+/u, '')
          .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]+/u, '')
          .replace(/^[\d]+[\.、)、]\s*/, '')                                  // 去掉 "1." "2、" 等序号前缀
          .replace(/^[一二三四五六七八九十百]+[、.、)]\s*/, '')                  // 去掉 "一、" "二、" 等中文序号前缀
          .replace(/[\s\]】)\-—:：~～]+$/u, '');
}
function sectionOf(line) {
  const s = stripSymbols(line).replace(/[\s:：]+$/, '');
  // 复合词放前面，避免被短词提前截断；整行需仅为段标题（可带 清单/列表/部分/如下 后缀）
  if (/^(食材|用料|材料|原料|主料|配料|配菜|备菜|食材准备|食材清单)(清单|列表|部分|如下)?$/.test(s)) return 'ing';
  if (/^(调料|调味料|调味|酱料|佐料|酱汁|料汁|腌料|蘸料)(清单|列表|部分|如下)?$/.test(s)) return 'sea';
  if (/^(做法|步骤|制作|过程|方法|烹饪|工序|流程|烹饪步骤|烹饪步骤清单)(清单|列表|部分|如下)?$/.test(s)) return 'step';
  return null;
}
function looksLikeSeasoning(l) { return SEASONING_KEYWORDS.some(k => l.includes(k)); }
function looksLikeMaterial(l) {
  if (/(适量|[g克斤两勺茶匙汤]|ml|kg|汤匙|茶匙)/i.test(l)) return true;
  return parseMaterial(l).qty != null;
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u ? String(u).slice(0, 40) : ''; }
}
/* 收藏夹：原文解析（按 食材/调料/做法 等关键词分段，无分段时启发式识别） */
function parseCollected(raw) {
  const lines = (raw || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let title = null;
  const titleLine = lines.find(l => /^(菜名|名称|名字|标题|菜谱名)[\s:：]/.test(l));
  if (titleLine) title = titleLine.replace(/^(菜名|名称|名字|标题|菜谱名)[\s:：]+/, '').trim();
  const ingredients = [], seasonings = [], steps = [];
  const hasHeader = lines.some(l => sectionOf(l));
  if (!hasHeader) {
    if (!title && lines.length && lines[0].length <= 24 && !/\d/.test(lines[0]) && !looksLikeMaterial(lines[0]) && !looksLikeSeasoning(lines[0])) title = lines[0];
    lines.forEach(l => {
      if (looksLikeSeasoning(l)) {
        const m = parseMaterial(l);
        if (m.name) seasonings.push({ name: m.name, amount: m.qty, unit: m.unit });
      } else if (looksLikeMaterial(l)) {
        const m = parseMaterial(l);
        if (m.name) ingredients.push({ name: m.name, amount: m.qty, unit: m.unit });
      } else {
        steps.push({ text: stripStepNo(l) });
      }
    });
  } else {
    let cur = null;
    lines.forEach(l => {
      const sec = sectionOf(l);
      if (sec) { cur = sec; return; }
      if (cur === 'ing') { const m = parseMaterial(l); if (m.name) ingredients.push({ name: m.name, amount: m.qty, unit: m.unit }); }
      else if (cur === 'sea') { const m = parseMaterial(l); if (m.name) seasonings.push({ name: m.name, amount: m.qty, unit: m.unit }); }
      else if (cur === 'step') { steps.push({ text: stripStepNo(l) }); }
      else {
        if (looksLikeSeasoning(l)) { const m = parseMaterial(l); if (m.name) seasonings.push({ name: m.name, amount: m.qty, unit: m.unit }); }
        else if (looksLikeMaterial(l)) { const m = parseMaterial(l); if (m.name) ingredients.push({ name: m.name, amount: m.qty, unit: m.unit }); }
        else if (!title && l.length <= 24) title = l;
        else steps.push({ text: stripStepNo(l) });
      }
    });
  }
  return { title, ingredients, seasonings, steps };
}
/* 收藏夹：转换时生成一道菜谱；有视频封面则作为菜谱封面，有文字版则解析成用料/步骤 */
function convertFavorite(c) {
  const r = blankRecipe();
  let parsedTitle = '';
  r.videoUrl = c.url || '';
  r.cover = c.cover || null;
  if (c.raw && c.raw.trim()) {
    const p = parseCollected(c.raw);
    parsedTitle = p.title || '';
    const mkItem = m => {
      const name = m.name.replace(/适量/g, '').trim() || m.name.trim();
      return {
        id: uid(), kind: 'item', name, amount: m.amount, unit: m.unit,
        text: [name, (m.amount != null ? m.amount : '') + (m.unit || '')].filter(Boolean).join(' '), images: [],
      };
    };
    r.sections.ingredients = p.ingredients.map(mkItem);
    r.sections.seasonings = p.seasonings.map(mkItem);
    r.sections.steps = p.steps.map(s => ({ id: uid(), kind: 'item', text: s.text, images: [] }));
  }
  if (c.note && c.note.trim()) {
    r.sections.steps.push({ id: uid(), kind: 'note', text: '备注：' + c.note.trim(), images: [] });
  }
  r.name = (c.title || '').trim() || parsedTitle || '未命名视频菜谱';
  state.recipes.push(r);
  c.recipeId = r.id; c.converted = true;
  save();
  return r;
}

/* ---------------- 状态 ---------------- */
let state = {
  recipes: [],
  view: 'library',
  editing: null,
  editingId: null,
  viewId: null,
  purchaseSelected: [],
  purchaseList: null,
  purchaseMergeSrc: null,
  filter: { cat: [], cook: [] },
  search: '',
  collections: [],
};
let dragSrc = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {            // 旧格式兼容
        state.recipes = parsed.map(migrateRecipe);
        state.collections = [];
      } else {
        state.recipes = (parsed.recipes || []).map(migrateRecipe);
        state.collections = (parsed.collections || []).map(migrateCollection);
      }
      return;
    }
  } catch (e) { console.warn('读取本地数据失败', e); }
  seed();
}
function migrateRecipe(r) {
  if (r.scaleBase === undefined) r.scaleBase = null;
  if (r.scaleAmount === undefined) r.scaleAmount = null;
  if (r.videoUrl === undefined) r.videoUrl = '';
  if (!r.sections.prep) r.sections.prep = [];
  ['ingredients', 'seasonings'].forEach(sec => {
    (r.sections[sec] || []).forEach(b => {
      if (b.kind === 'item' && b.name === undefined) {
        const m = parseMaterial(b.text || '');
        b.name = m.name; b.amount = m.qty; b.unit = m.unit;
      }
      if (b.images === undefined) b.images = [];
    });
  });
  return r;
}
function migrateCollection(c) {
  return {
    id: c.id || uid(),
    title: c.title || '',
    url: c.url || '',
    cover: c.cover || '',
    raw: c.raw || '',
    note: c.note || '',
    createdAt: c.createdAt || Date.now(),
    recipeId: c.recipeId || null,
    converted: !!c.converted,
  };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ recipes: state.recipes, collections: state.collections })); }
  catch (e) { toast('保存失败：本地存储空间可能已满（图片过多）'); }
  scheduleSync();
}

/* ---------------- GitHub 同步（私有库当数据库，实现跨设备 + 永久保存） ----------------
 * 本地 localStorage 仍是工作副本（秒开）；GitHub 私有库的 data.json 是云端镜像。
 * 每次 save() 防抖自动上传；启动时自动拉取 → 手机 / 电脑拿到同一份数据。 */
const SYNC_CFG_KEY = 'wb_recipe_sync_cfg_v1';
let _syncTimer = null, _suppressSync = false;
function getSyncCfg() { try { return JSON.parse(localStorage.getItem(SYNC_CFG_KEY)) || null; } catch (_) { return null; } }
function setSyncCfg(cfg) { try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg)); } catch (_) {} }
function syncEnabled() { const c = getSyncCfg(); return !!(c && c.token && c.repo); }
function syncBranch(c) { return (c && c.branch) || 'main'; }
function syncPath(c) { return (c && c.path) || 'data.json'; }
function updateSyncDot(status) { const d = document.getElementById('syncDot'); if (d) d.className = 'sync-dot ' + (status || ''); }

async function githubApi(path, opts) {
  const cfg = getSyncCfg();
  const headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' };
  if (opts && opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com/repos/' + cfg.repo + path, Object.assign({ headers }, opts || {}));
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('GitHub API ' + res.status + ' ' + t.slice(0, 140)); }
  return res;
}

/* 上传当前数据到 data.json（处理 SHA / 新建 / 409 冲突重试） */
async function githubPush() {
  if (!syncEnabled()) return false;
  const cfg = getSyncCfg();
  const payload = JSON.stringify({ recipes: state.recipes, collections: state.collections });
  const apiPath = '/contents/' + syncPath(cfg) + '?ref=' + syncBranch(cfg);
  let sha = null;
  try { const r = await githubApi(apiPath); const j = await r.json(); if (j && j.sha) sha = j.sha; } catch (_) { /* 文件不存在则新建 */ }
  const body = {
    message: 'recipe-workbench sync ' + new Date().toISOString(),
    content: btoa(unescape(encodeURIComponent(payload))),
    branch: syncBranch(cfg),
  };
  if (sha) body.sha = sha;
  try {
    await githubApi(apiPath, { method: 'PUT', body: JSON.stringify(body) });
    updateSyncDot('ok'); return true;
  } catch (e) {
    if (String(e.message).includes('409')) {            // 冲突：刷新 SHA 再试一次
      try {
        const r2 = await githubApi(apiPath); const j2 = await r2.json(); if (j2 && j2.sha) body.sha = j2.sha;
        await githubApi(apiPath, { method: 'PUT', body: JSON.stringify(body) });
        updateSyncDot('ok'); return true;
      } catch (e2) { updateSyncDot('err'); throw e2; }
    }
    updateSyncDot('err'); throw e;
  }
}

/* 从 data.json 拉取并覆盖本地（拉取期间抑制自动上传，避免回写） */
async function githubPull() {
  if (!syncEnabled()) return;
  const cfg = getSyncCfg();
  const apiPath = '/contents/' + syncPath(cfg) + '?ref=' + syncBranch(cfg);
  const res = await githubApi(apiPath);
  const j = await res.json();
  if (!j.content) throw new Error('云端文件为空');
  const txt = decodeURIComponent(escape(atob(j.content.replace(/\s/g, ''))));
  const data = JSON.parse(txt);
  if (Array.isArray(data.recipes)) state.recipes = data.recipes.map(migrateRecipe);
  if (Array.isArray(data.collections)) state.collections = data.collections.map(migrateCollection);
  _suppressSync = true; save(); _suppressSync = false;
  render();
  updateSyncDot('ok');
}

/* 防抖自动上传（在 save() 末尾调用） */
function scheduleSync() {
  if (_suppressSync) return;
  const cfg = getSyncCfg();
  if (!cfg || !cfg.auto || !cfg.token || !cfg.repo) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => { githubPush().catch(e => console.warn('自动同步失败', e)); }, 1200);
}

/* 同步设置弹窗 */
function openSyncModal() {
  const c = getSyncCfg() || {};
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel">
        <div class="modal-head">☁ 云端同步设置<span class="modal-close" data-action="modal-close">×</span></div>
        <div class="modal-body">
          <div class="field">
            <div class="field-label">GitHub 私人令牌 (PAT)</div>
            <input class="input" id="syncToken" type="password" placeholder="ghp_... 或 github_pat_..." value="${escAttr(c.token || '')}">
            <div class="field-hint">建议用 Fine-grained token，仅授予目标私有仓库的「Contents: Read/Write」。令牌只存于本机浏览器，不上传任何服务器。</div>
          </div>
          <div class="field">
            <div class="field-label">仓库 (owner/repo)</div>
            <input class="input" id="syncRepo" placeholder="yourname/recipe-data" value="${escAttr(c.repo || '')}">
          </div>
          <div class="field-row">
            <div class="field"><div class="field-label">分支</div><input class="input" id="syncBranch" placeholder="main" value="${escAttr(c.branch || 'main')}"></div>
            <div class="field"><div class="field-label">文件路径</div><input class="input" id="syncPath" placeholder="data.json" value="${escAttr(c.path || 'data.json')}"></div>
          </div>
          <label class="chk"><input type="checkbox" id="syncAuto" ${c.auto ? 'checked' : ''}> 自动同步（每次改动后上传；启动时从云端拉取）</label>
          <div class="sync-status" id="syncStatus"></div>
        </div>
        <div class="modal-actions">
          <button class="btn" data-action="sync-test">测试连接</button>
          <button class="btn" data-action="sync-pull">从云端拉取</button>
          <button class="btn primary" data-action="sync-save">保存设置</button>
        </div>
      </div>
    </div>`;
}

function seed() {
  const r1 = blankRecipe();
  r1.name = '西兰花炒鸡胸';
  r1.categories = ['禽类', '素菜']; r1.cookings = ['炒'];
  const ingChicken = Object.assign(blankItem(), { name: '鸡胸肉', amount: 250, unit: 'g', text: '鸡胸肉 250g' });
  const ingBroccoli = Object.assign(blankItem(), { name: '西兰花', amount: 1, unit: '颗', text: '西兰花 1 颗' });
  r1.sections.ingredients = [
    ingChicken,
    blankNote(),
    ingBroccoli,
  ];
  r1.sections.ingredients[1].text = '冷冻鸡胸提前一晚冷藏解冻，不要热水泡';
  const seaSoy = Object.assign(blankItem(), { name: '生抽', amount: 1, unit: '勺', text: '生抽 1 勺' });
  const seaSalt = Object.assign(blankItem(), { name: '盐', amount: 2, unit: 'g', text: '盐 2 g' });
  r1.sections.seasonings = [seaSoy, seaSalt];
  r1.sections.prep = [
    { id: uid(), title: '单独', members: [
      { refId: ingBroccoli.id, form: '切成小朵' },
      { refId: ingChicken.id, form: '切丁' },
      { refId: seaSoy.id, form: '' },
    ] },
  ];
  r1.sections.steps = [
    Object.assign({ id: uid(), kind: 'item', text: '西兰花焯水 1 分钟', images: [] }),
    blankNote(),
    Object.assign({ id: uid(), kind: 'item', text: '热锅下油煎鸡胸至两面金黄', images: [] }),
  ];
  r1.sections.steps[1].text = '焯水加少许盐更翠绿';

  const r2 = blankRecipe();
  r2.name = '番茄鸡蛋汤';
  r2.categories = ['素菜', '其他']; r2.cookings = ['煮'];
  r2.sections.ingredients = [
    Object.assign(blankItem(), { name: '番茄', amount: 2, unit: '个', text: '番茄 2 个' }),
    Object.assign(blankItem(), { name: '鸡蛋', amount: 2, unit: '个', text: '鸡蛋 2 个' }),
  ];
  r2.sections.seasonings = [Object.assign(blankItem(), { name: '盐', amount: 3, unit: 'g', text: '盐 3 g' })];
  r2.sections.steps = [
    Object.assign({ id: uid(), kind: 'item', text: '番茄切块炒出汁', images: [] }),
    Object.assign({ id: uid(), kind: 'item', text: '加水煮开倒入蛋液', images: [] }),
  ];

  state.recipes = [r1, r2];
  save();
}

const getRecipe = (id) => state.recipes.find(r => r.id === id);
const activeRecipe = () => state.editing || (state.viewId ? getRecipe(state.viewId) : null);
const findBlock = (sec, bid) => activeRecipe().sections[sec].find(b => b.id === bid);
const getProw = (col, id) => state.purchaseList[col].find(r => r.id === id);

/* ---------------- Toast / Modal ---------------- */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
function showImage(src) {
  $('modalRoot').innerHTML =
    `<div class="modal-mask" data-action="modal-close">
       <img class="modal-img" src="${src}">
       <button class="modal-close" data-action="modal-close">×</button>
     </div>`;
}
/* 添加图片前先裁剪选区：可框选要保留的图片区域，确认后才写入 */
let cropCtx = null;
function openCrop(sec, bid, src, onDone, onSkip) {
  cropCtx = { sec, bid, src, onDone, onSkip, finish: null };
  $('modalRoot').innerHTML =
    `<div class="modal-mask" data-action="modal-close">
       <div class="crop-modal">
         <div class="crop-title">拖拽框选要保留的区域（可移动 / 缩放）</div>
         <div class="crop-stage" id="cropStage">
           <img id="cropImg" src="${src}" alt="待裁剪">
           <div class="crop-box" id="cropBox">
             <span class="crop-handle" data-h="nw"></span><span class="crop-handle" data-h="n"></span><span class="crop-handle" data-h="ne"></span>
             <span class="crop-handle" data-h="e"></span><span class="crop-handle" data-h="se"></span><span class="crop-handle" data-h="s"></span>
             <span class="crop-handle" data-h="sw"></span><span class="crop-handle" data-h="w"></span>
           </div>
         </div>
         <div class="img-confirm-actions">
           <button class="btn" data-action="crop-confirm">确认裁剪</button>
           <button class="btn" data-action="crop-original">原图保留</button>
           <button class="btn ghost" data-action="modal-close">取消</button>
         </div>
       </div>
     </div>`;
  const img = $('cropImg'), box = $('cropBox'), stage = $('cropStage');
  const finish = (out) => {
    if (cropCtx && cropCtx._cleanup) cropCtx._cleanup();
    const cb = cropCtx && cropCtx.onDone;
    cropCtx = null; closeModal(); if (cb) cb(out);
  };
  cropCtx.finish = finish;

  // 拖拽状态（外层变量，onMove 必须回写到这里，setBox 才能读到最新值）
  let sw = 0, sh = 0, left = 0, top = 0, w = 0, h = 0, drag = null;
  const setBox = () => { box.style.left = left + 'px'; box.style.top = top + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px'; };
  const clamp = () => {
    if (w < 20) w = 20; if (h < 20) h = 20;
    if (left < 0) left = 0; if (top < 0) top = 0;
    if (left + w > sw) w = sw - left;
    if (top + h > sh) h = sh - top;
  };
  const initBox = () => {
    if (!sw) {
      sw = img.clientWidth || img.naturalWidth || stage.clientWidth || 400;
      sh = img.clientHeight || img.naturalHeight || 300;
    }
    left = sw * 0.15; top = sh * 0.15; w = sw * 0.7; h = sh * 0.7;
    clamp(); setBox();
  };
  const onDown = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    drag = { type, sx: e.clientX, sy: e.clientY, left, top, w, h };
    try { box.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    // 注意：这里用别名解构，计算完必须回写外层 left/top/w/h，否则 setBox 读不到
    let { left: L, top: T, w: W, h: H, type } = drag;
    const right = L + W, bottom = T + H;
    if (type.includes('e')) { W = Math.max(20, drag.w + dx); }
    if (type.includes('s')) { H = Math.max(20, drag.h + dy); }
    if (type.includes('w')) { L = Math.min(Math.max(0, drag.left + dx), right - 20); W = right - L; }
    if (type.includes('n')) { T = Math.min(Math.max(0, drag.top + dy), bottom - 20); H = bottom - T; }
    if (type === 'move') { L = drag.left + dx; T = drag.top + dy; }
    left = L; top = T; w = W; h = H;
    clamp(); setBox();
  };
  const onUp = (e) => {
    drag = null;
    try { box.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  // 立即绑定拖拽监听（不依赖图片 onload 时机，确保任何情况都能拖拽）
  box.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('crop-handle')) return; onDown(e, 'move'); });
  box.querySelectorAll('.crop-handle').forEach(hd => hd.addEventListener('pointerdown', (e) => onDown(e, hd.dataset.h)));
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  cropCtx._cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };
  // 图片加载完成后初始化选区尺寸（已缓存则立即）
  if (img.complete && img.naturalWidth) initBox();
  else img.onload = initBox;
  img.src = src;
}
function cropConfirm() {
  const img = $('cropImg'), box = $('cropBox');
  if (!img || !box || !cropCtx) { if (cropCtx && cropCtx.onSkip) cropCtx.onSkip(); return; }
  const sx = img.naturalWidth / img.clientWidth, sy = img.naturalHeight / img.clientHeight;
  const left = parseFloat(box.style.left), top = parseFloat(box.style.top),
        w = parseFloat(box.style.width), h = parseFloat(box.style.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * sx)); c.height = Math.max(1, Math.round(h * sy));
  c.getContext('2d').drawImage(img, left * sx, top * sy, w * sx, h * sy, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/jpeg', 0.85);
  cropCtx.finish(out);
}
/* 多图批量裁剪：逐张选区，全部完成后再写入条目 */
function startCropQueue(sec, bid, srcs) {
  const results = [];
  const run = () => {
    if (!srcs.length) {
      const b = findBlock(sec, bid);
      if (b) results.forEach(s => b.images.push(s));
      refreshSection(sec);
      return;
    }
    const src = srcs.shift();
    openCrop(sec, bid, src,
      (out) => { results.push(out); run(); },
      () => { run(); });   // 取消当前这张则跳过，继续下一张
  };
  run();
}
function closeModal() { $('modalRoot').innerHTML = ''; }
/* 删除确认：用应用内弹窗替代 window.confirm（预览 WebView 中 confirm 可能被禁用） */
function requestDelete(kind, id) {
  let name = '未命名';
  if (kind === 'recipe') {
    const r = getRecipe(id); if (!r) return; name = r.name || '未命名菜谱';
  } else {
    const c = state.collections.find(x => x.id === id); if (!c) return; name = c.title || '未命名收藏';
  }
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel del-confirm">
        <div class="modal-head">删除确认<span class="modal-close" data-action="modal-close">×</span></div>
        <div class="del-confirm-text">确定要删除「${escHtml(name)}」吗？<br>此操作不可撤销。</div>
        <div class="modal-actions">
          <button class="btn" data-action="modal-close">取消</button>
          <button class="btn danger" data-action="do-delete" data-kind="${escAttr(kind)}" data-did="${escAttr(id)}">删除</button>
        </div>
      </div>
    </div>`;
}

/* 打开视频：预览面板(WebView/iframe)常拦截原生 window.open，改应用内弹窗 —— 含可点击链接 + 复制 + 浏览器打开 */
function openVideoModal(url) {
  if (!url) { toast('没有可打开的视频链接'); return; }
  const host = hostOf(url);
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel">
        <div class="modal-head">▶ 打开视频<span class="modal-close" data-action="modal-close">×</span></div>
        <div class="modal-body">
          <div class="video-open-host">${escHtml(host || '外部链接')}</div>
          <a class="video-open-link" href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">${escHtml(url)}</a>
          <div class="modal-hint">如未自动跳转，请点「复制链接」后在浏览器中打开。</div>
        </div>
        <div class="modal-actions">
          <button class="btn" data-action="modal-close">关闭</button>
          <button class="btn" data-action="copy-url" data-url="${escAttr(url)}">📋 复制链接</button>
          <button class="btn primary" data-action="open-url" data-url="${escAttr(url)}">在浏览器打开</button>
        </div>
      </div>
    </div>`;
}

function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(t).then(() => toast('已复制到剪贴板')).catch(() => fallbackCopy(t));
  } else fallbackCopy(t);
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('已复制到剪贴板'); }
  catch (e) { toast('复制失败，请手动选择'); }
  document.body.removeChild(ta);
}
function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出采购清单');
}

/* ---------------- 路由 / 渲染分发 ---------------- */
function navigate(view) {
  if (view !== 'library') { state.editing = null; state.viewId = null; }
  state.view = view;
  render();
}
function render() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === state.view));
  if (state.view === 'library' && state.editing) { renderEditor(); return; }
  if (state.view === 'library' && state.viewId) { renderRecipeView(state.viewId); return; }
  if (state.view === 'library') { renderLibrary(); return; }
  if (state.view === 'purchase') { renderPurchase(); return; }
  if (state.view === 'filter') { renderFilter(); return; }
  if (state.view === 'nutrition') { renderNutrition(); return; }
  if (state.view === 'favorites') { renderFavorites(); return; }
}
function setChrome(crumb, actionsHTML) {
  $('crumb').textContent = crumb;
  $('topbarActions').innerHTML = actionsHTML || '';
}

/* ---------------- 菜谱库（列表） ---------------- */
function recipeMatches(r, q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.name,
    ...r.categories,
    ...r.cookings,
    ...r.sections.ingredients.filter(b => b.kind === 'item').map(b => b.name || b.text),
    ...r.sections.seasonings.filter(b => b.kind === 'item').map(b => b.name || b.text),
    ...r.sections.steps.filter(b => b.kind === 'item').map(b => b.text),
    ...(r.sections.prep || []).flatMap(g => g.members.map(m => {
      const mat = findMaterialByRefIn(r, m.refId);
      return mat ? (mat.name || '') : '';
    })),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}
function renderLibrary() {
  setChrome('菜谱库', `<button class="btn primary" data-action="open-editor-new">＋ 新增菜谱</button>`);
  const q = (state.search || '').trim();
  const list = q ? state.recipes.filter(r => recipeMatches(r, q)) : state.recipes;
  const content = $('content');
  if (!state.recipes.length) {
    content.innerHTML = `<div class="empty"><div class="big">🍽️</div>还没有菜谱，点击右上角「新增菜谱」开始记录吧</div>`;
    return;
  }
  if (!list.length) {
    content.innerHTML = `<div class="empty"><div class="big">🔍</div>没有找到与「${escHtml(q)}」匹配的菜谱<div class="hint">换个关键词试试，或清空搜索框</div></div>`;
    return;
  }
  const banner = q ? `<div class="search-banner">🔍 搜索「${escHtml(q)}」：${list.length} 道菜谱</div>` : '';
  content.innerHTML = banner + `<div class="grid">${list.map(recipeCardHTML).join('')}</div>`;
}
function countText(r) {
  const i = r.sections.ingredients.filter(b => b.kind === 'item').length;
  const s = r.sections.seasonings.filter(b => b.kind === 'item').length;
  const p = r.sections.steps.filter(b => b.kind === 'item').length;
  const pr = (r.sections.prep || []).length;
  return `食材 ${i} · 调味料 ${s} · 备菜 ${pr} · 步骤 ${p}`;
}
function recipeCardHTML(r) {
  const cover = r.cover ? `style="background-image:url('${r.cover}')"` : '';
  const coverTxt = r.cover ? '' : '无封面';
  const tags = r.categories.map(t => `<span class="mini-tag">${escHtml(t)}</span>`).join('') +
    r.cookings.map(t => `<span class="mini-tag cook">${escHtml(t)}</span>`).join('');
  return `
    <div class="recipe-card" data-action="view-recipe" data-id="${r.id}">
      <button class="recipe-del" data-action="del-recipe" data-id="${r.id}" title="删除">×</button>
      <div class="recipe-cover" ${cover}>${coverTxt}</div>
      <div class="recipe-body">
        <div class="recipe-name">${escHtml(r.name) || '未命名菜谱'}</div>
        <div class="tagrow">${tags}</div>
        <div class="recipe-meta">${countText(r)}</div>
      </div>
    </div>`;
}

/* ---------------- 菜谱收藏夹（视频链接 + 文字版） ---------------- */
let favCoverImg = '';
function renderFavCoverPreview() {
  const box = document.getElementById('favCoverPreview'); if (!box) return;
  box.innerHTML = favCoverImg
    ? `<span class="fav-thumb" style="background-image:url('${favCoverImg}')"></span>`
    : `<span class="fav-cover-ph">未设置封面</span>`;
}
function openFavForm(mode, c) {
  const isEdit = mode === 'edit';
  const cv = isEdit ? c : null;
  favCoverImg = (isEdit && c) ? (c.cover || '') : '';
  const coverUrlVal = (isEdit && c && c.cover && !String(c.cover).startsWith('data:')) ? c.cover : '';
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel fav-add">
        <div class="modal-head">${isEdit ? '编辑收藏' : '添加收藏'}<span class="modal-close" data-action="modal-close">×</span></div>
        <div class="field">
          <label>视频链接（抖音 / 小红书 等）*</label>
          <input id="favUrl" class="input" placeholder="粘贴视频链接，如 https://v.douyin.com/xxxx/" value="${escAttr(cv ? cv.url : '')}">
        </div>
        <div class="field">
          <label>标题（视频介绍里的菜名，可删改）</label>
          <input id="favTitle" class="input" placeholder="如：小红书·红烧肉" value="${escAttr(cv ? cv.title : '')}">
        </div>
        <div class="field">
          <label>封面（建议用视频封面截图 / 图片链接，转菜谱时作为菜谱封面）</label>
          <input type="file" id="favCoverFile" class="fav-file" accept="image/*">
          <input id="favCoverUrl" class="input" placeholder="或粘贴封面图片链接" value="${escAttr(coverUrlVal)}">
          <div class="fav-thumbs" id="favCoverPreview"></div>
        </div>
        <div class="field">
          <label>文字版（粘贴菜谱原文，后期可一键转成菜谱格式）</label>
          <textarea id="favRaw" class="fav-raw" placeholder="食材：&#10;五花肉 500g&#10;冰糖 30g&#10;做法：&#10;1. 切块焯水&#10;2. 炒糖色…">${escHtml(cv ? (cv.raw || '') : '')}</textarea>
        </div>
        <div class="field">
          <label>备注（可选）</label>
          <textarea id="favNote" class="fav-raw" placeholder="随手记一下这个视频的亮点…">${escHtml(cv ? (cv.note || '') : '')}</textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" data-action="modal-close">取消</button>
          <button class="btn primary" data-action="${isEdit ? 'fav-update' : 'fav-save'}" data-id="${isEdit ? cv.id : ''}">${isEdit ? '保存修改' : '保存收藏'}</button>
        </div>
      </div>
    </div>`;
  renderFavCoverPreview();
  const fileInp = document.getElementById('favCoverFile');
  if (fileInp) fileInp.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { favCoverImg = await compressImage(f, 1280, 0.82); renderFavCoverPreview(); } catch (_) {}
  });
  const urlInp = document.getElementById('favCoverUrl');
  if (urlInp) urlInp.addEventListener('input', () => { favCoverImg = urlInp.value.trim(); renderFavCoverPreview(); });
  /* 粘贴视频链接后，自动从页面抓取标题与封面（后端 /api/meta 代理，绕过跨域） */
  const linkInp = document.getElementById('favUrl');
  if (linkInp) {
    let tmr = null;
    linkInp.addEventListener('input', () => {
      clearTimeout(tmr);
      const v = linkInp.value.trim();
      if (!v) return;
      tmr = setTimeout(async () => {
        try {
          const base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? '' : 'http://localhost:3456';
          const resp = await fetch(base + '/api/meta?url=' + encodeURIComponent(v));
          const meta = await resp.json();
          const titleEl = document.getElementById('favTitle');
          if (meta.title && titleEl && !titleEl.value) titleEl.value = meta.title;
          if (meta.image) { favCoverImg = meta.image; renderFavCoverPreview(); }
        } catch (_) { /* 抓取失败不影响手动填写 */ }
      }, 500);
    });
  }
}
/* 收藏对应的菜谱是否还在菜谱库中（用于判断能否「查看」/是否需要「重新转换」） */
function favRecipeExists(c) {
  return !!(c && c.converted && c.recipeId && state.recipes.some(r => r.id === c.recipeId));
}
function favCardHTML(c) {
  const host = hostOf(c.url);
  const note = (c.note || '').replace(/\s+/g, ' ').slice(0, 60);
  const exists = favRecipeExists(c);
  const badge = exists
    ? `<span class="fav-badge ok">已转换</span>`
    : (c.converted ? `<span class="fav-badge warn">待重新转换</span>` : `<span class="fav-badge">待转换</span>`);
  const actions = exists
    ? `<button class="btn sm" data-action="fav-view" data-id="${c.id}">查看菜谱</button>`
    : `<button class="btn sm primary" data-action="fav-convert" data-id="${c.id}">${c.converted ? '⚡ 重新转换' : '⚡ 转成菜谱'}</button>`;
  const coverBg = c.cover ? `style="background-image:url('${c.cover}')"` : '';
  const coverInner = c.cover ? '' : (c.url ? '▶ 视频' : '🔗 链接');
  return `
    <div class="fav-card" data-action="fav-open" data-id="${c.id}">
      <button class="recipe-del" data-action="fav-del" data-id="${c.id}" title="删除">×</button>
      <div class="fav-cover ${c.cover ? '' : 'fav-video'}" ${coverBg}>${coverInner}</div>
      <div class="fav-body">
        <div class="fav-name">${escHtml(c.title || '未命名收藏')} ${badge}</div>
        <div class="fav-meta">${host ? '🔗 ' + escHtml(host) : '（无链接）'}${note ? ' · ' + escHtml(note) : ''}</div>
        <div class="fav-actions">
          <button class="btn sm" data-action="fav-edit" data-id="${c.id}">✏️ 编辑</button>
          <button class="btn sm" data-action="fav-open" data-id="${c.id}">▶ 看视频</button>
          ${actions}
        </div>
      </div>
    </div>`;
}
function renderFavorites() {
  setChrome('菜谱收藏夹', `<button class="btn primary" data-action="fav-add">＋ 添加收藏</button>`);
  const content = $('content');
  if (!state.collections.length) {
    content.innerHTML = `<div class="empty"><div class="big">📋</div>收藏夹还是空的<div class="hint">把抖音 / 小红书的视频链接粘贴进来：点卡片即可跳转看视频，也能一键转成菜谱库里的菜（视频会作为来源挂在菜谱上，方便边看边填用料和步骤）</div></div>`;
    return;
  }
  content.innerHTML = `<div class="grid">${state.collections.map(favCardHTML).join('')}</div>`;
}


/* ---------------- 菜谱查看（只读） ---------------- */
function renderRecipeView(id) {
  const r = getRecipe(id);
  if (!r) { renderLibrary(); return; }
  state.viewId = id;
  setChrome('菜谱库 / 查看',
    `<button class="btn" data-action="back-library">← 返回</button>
     <button class="btn primary" data-action="edit-recipe" data-id="${id}">✏️ 编辑</button>`);
  const cover = r.cover ? `<div class="view-cover" style="background-image:url('${r.cover}')"></div>` : '';
  const tags = r.categories.map(t => `<span class="mini-tag">${escHtml(t)}</span>`).join('') +
    r.cookings.map(t => `<span class="mini-tag cook">${escHtml(t)}</span>`).join('');
  const content = $('content');
  const f = scaleFactorOf(r);
  content.innerHTML = `
    <div class="view">
      ${cover}
      <div class="view-head">
        <h1>${escHtml(r.name) || '未命名菜谱'}</h1>
        <div class="tagrow">${tags}</div>
        ${r.videoUrl ? `<a class="view-video" href="${escAttr(r.videoUrl)}" target="_blank" rel="noopener">🔗 来源视频</a>` : ''}
        ${portionControlHTML(r, 'portion')}
      </div>
      <div class="view-sec" id="vsec-ingredients"><h3>食材</h3>${viewListHTML(r.sections.ingredients, true, f)}</div>
      <div class="view-sec" id="vsec-seasonings"><h3>调味料</h3>${viewListHTML(r.sections.seasonings, true, f)}</div>
      <div class="view-sec" id="vsec-prep"><h3>备菜</h3>${viewPrepHTML(r, f)}</div>
      <div class="view-sec"><h3>烹饪步骤</h3>${viewListHTML(r.sections.steps, false)}</div>
    </div>`;
}
/* 仅刷新查看页三个用量板块（保持分量输入框聚焦），不重渲染整页 */
function refreshViewScaled(r) {
  const f = scaleFactorOf(r);
  const ing = $('vsec-ingredients'); if (ing) ing.innerHTML = `<h3>食材</h3>${viewListHTML(r.sections.ingredients, true, f)}`;
  const sea = $('vsec-seasonings'); if (sea) sea.innerHTML = `<h3>调味料</h3>${viewListHTML(r.sections.seasonings, true, f)}`;
  const prep = $('vsec-prep'); if (prep) prep.innerHTML = `<h3>备菜</h3>${viewPrepHTML(r, f)}`;
}
function viewPrepHTML(r, factor) {
  factor = factor == null ? 1 : factor;
  const groups = r.sections.prep || [];
  if (!groups.length) return `<div class="view-empty">（无）</div>`;
  return `<div class="view-list">` + groups.map(g => {
    const members = g.members.map(m => {
      const mat = findMaterialByRefIn(r, m.refId);
      const name = mat ? (mat.name || '未命名') : '（已删除用料）';
      let qty = m.qty != null ? m.qty : (mat && mat.amount != null ? scaleAmt(mat.amount, factor) : null);
      const unit = m.unit || (mat && mat.unit) || '';
      const amtText = (qty != null && qty !== '') ? (qty + unit) : (qty == null ? '适量' : '');
      const form = m.form ? `（${m.form}）` : '';
      const text = [name, amtText, form].filter(Boolean).join(' ');
      return `<div class="view-item">${escHtml(text)}</div>`;
    }).join('');
    return `<div class="view-group"><div class="view-group-title">${escHtml(g.title || '备菜')}</div><div class="view-list cols">${members || '<div class="view-empty">（无）</div>'}</div></div>`;
  }).join('') + `</div>`;
}
function viewListHTML(arr, structured, factor) {
  factor = factor == null ? 1 : factor;
  if (!arr.length) return `<div class="view-empty">（无）</div>`;
  const cls = structured ? 'view-list cols' : 'view-list';
  let stepNo = 0;
  return `<div class="${cls}">` + arr.map(b => {
    if (b.kind === 'note') {
      const imgs2 = (b.images || []).map((img, idx) => `<span class="v-thumb" style="background-image:url('${img}')" data-action="enlarge-view" data-bid="${b.id}" data-idx="${idx}"></span>`).join('');
      return `<div class="view-note">📝 ${escHtml(b.text)}${imgs2}</div>`;
    }
    if (structured) {
      const scaled = scaleAmt(b.amount, factor);
      const amt = scaled == null ? '适量' : (scaled + (b.unit || ''));
      const text = [b.name, amt].filter(Boolean).join(' ');
      const imgs = (b.images || []).map((img, idx) => `<span class="v-thumb" style="background-image:url('${img}')" data-action="enlarge-view" data-bid="${b.id}" data-idx="${idx}"></span>`).join('');
      return `<div class="view-item">${escHtml(text)}${imgs}</div>`;
    }
    stepNo += 1;
    const imgs = (b.images || []).map((img, idx) => `<span class="v-thumb" style="background-image:url('${img}')" data-action="enlarge-view" data-bid="${b.id}" data-idx="${idx}"></span>`).join('');
    return `<div class="view-step"><span class="step-no">${stepNo}</span><span class="step-text">${escHtml(b.text)}</span>${imgs}</div>`;
  }).join('') + `</div>`;
}

/* ---------------- 编辑器 ---------------- */
function openEditor(id) {
  state._editReturn = { viewId: state.viewId };
  if (id) {
    const src = getRecipe(id);
    state.editing = JSON.parse(JSON.stringify(src));
    state.editingId = id;
  } else {
    state.editing = blankRecipe();
    state.editingId = null;
  }
  state.view = 'library';
  state.viewId = null;
  render();
}
function renderEditor() {
  setChrome('菜谱库 / 编辑菜谱', '');
  const content = $('content');
  content.innerHTML = `
    <div class="editor">
      <div class="editor-head" id="editorHead"></div>
      <datalist id="seasoning-list">${SEASONING_SUGGESTIONS.map(s => `<option value="${escAttr(s)}">`).join('')}</datalist>
      ${SECTIONS.map(s => `
        <div class="section-block">
          <div class="section-bar">
            <h3>${s.title} <span class="section-count" id="cnt-${s.key}"></span></h3>
          </div>
          <div class="section-body" id="sec-${s.key}"></div>
        </div>`).join('')}
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
        <button class="btn ghost" data-action="cancel">取消</button>
        <button class="btn primary" data-action="save">保存菜谱</button>
      </div>
    </div>`;
  refreshHeader();
  SECTIONS.forEach(s => refreshSection(s.key));
}
function refreshHeader() {
  const r = state.editing;
  const head = $('editorHead');
  head.innerHTML = `
    <div class="field">
      <div class="field-label">菜谱名称 <span class="req">*</span></div>
      <input class="input" id="f-name" placeholder="请输入菜谱名称" value="${escAttr(r.name)}">
    </div>
    <div class="field">
      <div class="field-label">封面图</div>
      <div class="cover-zone">
        <div class="cover-preview ${r.cover ? 'has-img' : ''}"
             style="${r.cover ? `background-image:url('${r.cover}')` : ''}"
             data-action="${r.cover ? 'cover-enlarge' : 'cover-upload'}">
          ${r.cover ? '' : '点击上传封面'}
        </div>
        <div class="cover-actions">
          <button class="btn sm" data-action="cover-upload">上传图片</button>
          <button class="btn sm" data-action="cover-camera">拍照上传</button>
          ${r.cover ? '<button class="btn sm danger" data-action="cover-del">删除 / 替换</button>' : ''}
          <div class="cover-empty-hint">建议 4:3 或正方形，自动压缩至 1280px 以内</div>
        </div>
      </div>
    </div>
    <div class="field">
      <div class="field-label">菜品分类（可多选）</div>
      <div class="chip-pool-label">V1 固定标签，不可自定义新增</div>
      <div class="tagpool">${CATEGORY_TAGS.map(t =>
        `<span class="chip ${r.categories.includes(t) ? 'on' : ''}" data-action="toggle-tag" data-type="cat" data-tag="${escAttr(t)}">${t}</span>`).join('')}</div>
    </div>
    <div class="field">
      <div class="field-label">烹饪方式（可多选）</div>
      <div class="chip-pool-label">V1 固定标签，不可自定义新增</div>
      <div class="tagpool">${COOKING_TAGS.map(t =>
        `<span class="chip cook ${r.cookings.includes(t) ? 'on' : ''}" data-action="toggle-tag" data-type="cook" data-tag="${escAttr(t)}">${t}</span>`).join('')}</div>
    </div>
    <div class="field">
      <div class="field-label">来源视频链接（可选）</div>
      <div class="video-url-row">
        <input class="input" id="f-video" placeholder="如 https://v.douyin.com/xxxx/" value="${escAttr(r.videoUrl || '')}">
        <button class="btn sm" data-action="open-video">▶ 看视频</button>
      </div>
    </div>`;
}
function itemCount(key) {
  return state.editing.sections[key].filter(b => b.kind === 'item').length;
}
function refreshSection(key) {
  const body = $('sec-' + key);
  body.innerHTML = sectionBodyHTML(key);
  if (key === 'prep') $('cnt-' + key).textContent = `${state.editing.sections.prep.length} 组`;
  else $('cnt-' + key).textContent = `${itemCount(key)} 项`;
}
function sectionBodyHTML(key) {
  if (key === 'prep') return prepSectionHTML();
  const r = state.editing;
  const arr = r.sections[key];
  const meta = SECTIONS.find(s => s.key === key);
  const last = arr.length - 1;
  const rows = arr.map((b, i) => {
    if (b.kind === 'note') return noteRowHTML(key, b, i, last);
    return meta.structured ? materialRowHTML(key, b, i, last) : stepRowHTML(key, b, i, last);
  }).join('');
  const batch = meta.structured ? batchAreaHTML(key) : '';
  const addLabel = key === 'steps' ? '＋ 新增步骤' : '＋ 手动添加一条';
  const colsClass = meta.structured ? 'cols' : 'list';
  return `${batch}<div class="rows ${colsClass}">${rows}</div><div class="add-row"><button class="add-btn" data-action="add-item" data-sec="${key}">${addLabel}</button></div>`;
}
function batchAreaHTML(key) {
  return `
    <div class="batch-area">
      <textarea class="batch-input" data-sec="${key}" placeholder="每行一条，可粘贴整段后点「识别并分点」。例如：&#10;鸡胸肉 250g&#10;西兰花 1 颗&#10;生抽 1 勺"></textarea>
      <div class="batch-actions">
        <button class="btn sm" data-action="batch-parse" data-sec="${key}">⤵ 识别并分点</button>
        <span class="batch-hint">粘贴多行文本自动解析名称/数量/单位；可多次操作</span>
      </div>
    </div>`;
}
function materialRowHTML(key, b, i, last) {
  const imgs = (b.images || []).map((img, idx) => thumbHTML(key, b.id, idx, img)).join('');
  const listAttr = key === 'seasonings' ? 'list="seasoning-list"' : '';
  return `
    <div class="ritem" data-row data-sec="${key}" data-bid="${b.id}" tabindex="0">
      <div class="rline">
        <span class="grip" title="按住拖拽排序">⠿</span>
        <span class="idx">${i + 1}</span>
        <input class="rname" ${listAttr} data-sec="${key}" data-bid="${b.id}" value="${escAttr(b.name || '')}" placeholder="名称">
        <input class="ramount" type="number" step="0.5" data-sec="${key}" data-bid="${b.id}" value="${b.amount == null ? '' : b.amount}" placeholder="用量">
        <input class="runit" list="unit-list" data-sec="${key}" data-bid="${b.id}" value="${escAttr(b.unit || '')}" placeholder="单位">
        <div class="r-imgs">${imgs}</div>
      </div>
      <div class="ractions">
        <button class="tiny" data-action="add-image" data-sec="${key}" data-bid="${b.id}">🖼️ 图片</button>
        <button class="tiny" data-action="ins-note-above" data-sec="${key}" data-bid="${b.id}">📝 备注↑</button>
        <button class="tiny" data-action="ins-note-below" data-sec="${key}" data-bid="${b.id}">📝 备注↓</button>
        <button class="tiny" data-action="move-up" data-sec="${key}" data-bid="${b.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="tiny" data-action="move-down" data-sec="${key}" data-bid="${b.id}" ${i === last ? 'disabled' : ''}>↓</button>
        <button class="tiny danger" data-action="del-block" data-sec="${key}" data-bid="${b.id}">🗑</button>
      </div>
    </div>`;
}
function stepRowHTML(key, b, i, last) {
  const imgs = (b.images || []).map((img, idx) => thumbHTML(key, b.id, idx, img)).join('');
  return `
    <div class="ritem" data-row data-sec="${key}" data-bid="${b.id}" tabindex="0">
      <div class="rline">
        <span class="grip" title="按住拖拽排序">⠿</span>
        <span class="idx">${i + 1}</span>
        <textarea class="rsteptext" data-sec="${key}" data-bid="${b.id}" placeholder="如：西兰花焯水 1 分钟">${escHtml(b.text)}</textarea>
        <div class="r-imgs">${imgs}</div>
      </div>
      <div class="ractions">
        <button class="tiny" data-action="add-image" data-sec="${key}" data-bid="${b.id}">🖼️ 图片</button>
        <button class="tiny" data-action="ins-note-above" data-sec="${key}" data-bid="${b.id}">📝 备注↑</button>
        <button class="tiny" data-action="ins-note-below" data-sec="${key}" data-bid="${b.id}">📝 备注↓</button>
        <button class="tiny" data-action="move-up" data-sec="${key}" data-bid="${b.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="tiny" data-action="move-down" data-sec="${key}" data-bid="${b.id}" ${i === last ? 'disabled' : ''}>↓</button>
        <button class="tiny danger" data-action="del-block" data-sec="${key}" data-bid="${b.id}">🗑</button>
      </div>
    </div>`;
}
function noteRowHTML(key, b, i, last) {
  const imgs = (b.images || []).map((img, idx) => thumbHTML(key, b.id, idx, img)).join('');
  return `
    <div class="ritem note" data-row data-sec="${key}" data-bid="${b.id}" tabindex="0">
      <div class="rline">
        <span class="grip" title="按住拖拽排序">⠿</span>
        <span class="idx note-idx">📝</span>
        <textarea class="rnote" data-sec="${key}" data-bid="${b.id}" placeholder="小贴士 / 避雷提醒 / 替代食材…">${escHtml(b.text)}</textarea>
        <div class="r-imgs">${imgs}</div>
      </div>
      <div class="ractions">
        <button class="tiny" data-action="add-image" data-sec="${key}" data-bid="${b.id}">🖼️ 图片</button>
        <button class="tiny" data-action="move-up" data-sec="${key}" data-bid="${b.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="tiny" data-action="move-down" data-sec="${key}" data-bid="${b.id}" ${i === last ? 'disabled' : ''}>↓</button>
        <button class="tiny danger" data-action="del-block" data-sec="${key}" data-bid="${b.id}">🗑</button>
      </div>
    </div>`;
}
function thumbHTML(key, bid, idx, img) {
  return `<div class="thumb" style="background-image:url('${img}')" data-action="enlarge" data-sec="${key}" data-bid="${bid}" data-idx="${idx}">
      <button class="x" data-action="del-image" data-sec="${key}" data-bid="${bid}" data-idx="${idx}">×</button>
    </div>`;
}

/* ---------------- 备菜板块 ---------------- */
function findMaterialByRef(refId) {
  const r = state.editing;
  return [...r.sections.ingredients, ...r.sections.seasonings]
    .find(b => b.id === refId && b.kind === 'item');
}
function findMaterialByRefIn(recipe, refId) {
  return [...recipe.sections.ingredients, ...recipe.sections.seasonings]
    .find(b => b.id === refId && b.kind === 'item');
}
function findPrepGroup(gid) {
  return state.editing.sections.prep.find(g => g.id === gid);
}
function matLabel(b) {
  return (b.name || '未命名') + (b.amount != null ? ' ' + b.amount + (b.unit || '') : '');
}
function prepSectionHTML() {
  const groups = state.editing.sections.prep;
  const list = groups.map(g => prepGroupHTML(g)).join('');
  return `${list}<div class="add-row"><button class="add-btn" data-action="add-prep-group">＋ 新增备菜组</button></div>`;
}
function prepGroupHTML(g) {
  const members = g.members.map(m => {
    const mat = findMaterialByRef(m.refId);
    const label = mat ? matLabel(mat) : '（已删除用料）';
    const srcQty = mat && mat.amount != null ? mat.amount : '';
    const srcUnit = mat && mat.unit ? mat.unit : '';
    return `
      <div class="prep-member">
        <span class="pm-name">${escHtml(label)}</span>
        <input class="pm-qty" type="number" step="0.5" data-gid="${g.id}" data-ref="${escAttr(m.refId)}" value="${m.qty != null ? m.qty : ''}" placeholder="${escAttr(String(srcQty))}" title="用量（留空则用来源用量）">
        <input class="pm-unit" list="unit-list" data-gid="${g.id}" data-ref="${escAttr(m.refId)}" value="${escAttr(m.unit || '')}" placeholder="${escAttr(srcUnit)}" title="单位（可改）">
        <input class="pm-form" data-gid="${g.id}" data-ref="${escAttr(m.refId)}" value="${escAttr(m.form || '')}" placeholder="处理形态，如：切断">
        <button class="tiny danger" data-action="prep-del-member" data-gid="${g.id}" data-ref="${escAttr(m.refId)}" title="移除">×</button>
      </div>`;
  }).join('');
  return `
    <div class="prep-group">
      <div class="prep-group-head">
        <input class="prep-g-title" data-gid="${g.id}" value="${escAttr(g.title || '')}" placeholder="备菜组名称">
        <button class="tiny danger" data-action="prep-del-group" data-gid="${g.id}">删除组</button>
      </div>
      <div class="prep-members">${members || '<div class="prep-empty">尚未选择用料</div>'}</div>
      <button class="add-btn sm" data-action="prep-add-member" data-gid="${g.id}">＋ 从食材/调味料选择</button>
    </div>`;
}
function openPrepPicker(gid) {
  const g = findPrepGroup(gid);
  if (!g) return;
  const existing = new Set(g.members.map(m => m.refId));
  const all = [];
  ['ingredients', 'seasonings'].forEach(sec => {
    state.editing.sections[sec].forEach(b => { if (b.kind === 'item') all.push({ sec, b }); });
  });
  const opts = all.map(({ sec, b }) => {
    const secLabel = sec === 'ingredients' ? '食材' : '调味料';
    return `<label class="prep-pick"><input type="checkbox" data-ref="${b.id}" ${existing.has(b.id) ? 'checked' : ''}>
      <span class="pp-name">${escHtml(matLabel(b))}</span><span class="pp-sec">${secLabel}</span></label>`;
  }).join('') || '<div class="prep-empty">请先在「食材」「调味料」中输入用料</div>';
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="prep-picker">
        <div class="crop-title">选择要加入「${escHtml(g.title || '备菜')}」的用料</div>
        <div class="prep-pick-list">${opts}</div>
        <div class="img-confirm-actions">
          <button class="btn" data-action="prep-pick-confirm" data-gid="${escAttr(gid)}">确定</button>
          <button class="btn ghost" data-action="modal-close">取消</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- 采购 ---------------- */
function recomputePurchase() {
  const ing = [], sea = [];
  state.purchaseSelected.forEach(rid => {
    const r = getRecipe(rid); if (!r) return;
    const f = scaleFactorOf(r);
    r.sections.ingredients.forEach(b => {
      if (b.kind === 'item') {
        const name = b.name || parseMaterial(b.text).name;
        let qty = b.amount != null ? b.amount : parseMaterial(b.text).qty;
        if (qty != null) qty = scaleAmt(qty, f);
        const unit = b.unit || parseMaterial(b.text).unit;
        if (name) ing.push({ name, qty, unit });
      }
    });
    r.sections.seasonings.forEach(b => {
      if (b.kind === 'item') {
        const name = b.name || parseMaterial(b.text).name;
        let qty = b.amount != null ? b.amount : parseMaterial(b.text).qty;
        if (qty != null) qty = scaleAmt(qty, f);
        const unit = b.unit || parseMaterial(b.text).unit;
        if (name) sea.push({ name, qty, unit });
      }
    });
  });
  state.purchaseList = { ingredients: mergeRows(ing), seasonings: mergeRows(sea) };
}
function mergeRows(rows) {
  const map = new Map();
  rows.forEach(r => {
    const key = norm(r.name) + '|' + norm(r.unit);
    if (map.has(key)) {
      const e = map.get(key);
      if (r.qty != null) e.qty = (e.qty || 0) + r.qty;
    } else {
      map.set(key, { id: uid(), name: r.name, qty: r.qty, unit: r.unit, done: false });
    }
  });
  return [...map.values()];
}
function mergeSameName(col) {
  const rows = state.purchaseList[col];
  const map = new Map(); const out = [];
  rows.forEach(r => {
    const key = norm(r.name);
    if (map.has(key)) {
      const e = map.get(key);
      if (r.qty != null) e.qty = (e.qty || 0) + r.qty;
      if (!e.unit && r.unit) e.unit = r.unit;
    } else { map.set(key, r); out.push(r); }
  });
  state.purchaseList[col] = out;
}
function renderPurchase() {
  setChrome('点菜采购', '');
  const content = $('content');
  const recipes = state.recipes;
  if (!state.purchaseSelected.length && !state.purchaseList) { /* fallthrough */ }
  const selList = recipes.map(r => {
    const on = state.purchaseSelected.includes(r.id);
    const tags = r.categories.map(t => `<span class="mini-tag">${escHtml(t)}</span>`).join('') +
      r.cookings.map(t => `<span class="mini-tag cook">${escHtml(t)}</span>`).join('');
    return `
      <div class="sel-row">
        <input type="checkbox" ${on ? 'checked' : ''} data-action="sel-toggle" data-id="${r.id}">
        <span class="nm">${escHtml(r.name) || '未命名菜谱'}</span>
        <span class="tg">${tags}</span>
        ${portionControlHTML(r, 'p-portion')}
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="section-head">
      <div><span class="section-title">选择菜谱</span><span class="section-sub">勾选即实时汇总采购清单；每行可选基准食材并调整分量</span></div>
    </div>
    <div class="select-list">${selList || '<div class="empty">暂无菜谱，请先到「菜谱库」添加</div>'}</div>
    <div id="purchase-list">${purchaseListHTML()}</div>`;
}
/* 仅刷新采购清单区域（保持选购行的分量输入框聚焦） */
function refreshPurchaseList() {
  const el = $('purchase-list'); if (!el) return;
  el.innerHTML = purchaseListHTML();
}
function purchaseListHTML() {
  if (!state.purchaseList) return `<div class="empty">勾选上方菜谱后，下方实时显示采购清单</div>`;
  const L = state.purchaseList;
  return `
    <div class="purchase-actions">
      <span class="batch-hint">已选 ${state.purchaseSelected.length} 道 · 实时汇总</span>
      <button class="btn sm" data-action="p-selall">☑ 全部勾选</button>
      <button class="btn sm" data-action="p-clear">☐ 清空勾选</button>
      <button class="btn sm" data-action="p-copy">📄 复制清单</button>
      <button class="btn sm" data-action="p-export">⬇ 导出纯文本</button>
      <button class="btn sm ghost" data-action="p-recompute">↻ 重新汇总</button>
    </div>
    <div class="purchase-cols">
      ${purchaseColHTML('ingredients', '食材清单', L.ingredients)}
      ${purchaseColHTML('seasonings', '调味料清单', L.seasonings)}
    </div>`;
}
function purchaseColHTML(col, title, rows) {
  const hint = state.purchaseMergeSrc ? `<div class="merge-hint">已选合并来源（高亮），请点击另一条的「合并」将其并入</div>` : '';
  const body = rows.length ? rows.map(r => purchaseRowHTML(col, r)).join('') :
    `<div class="pcol-empty">暂无${title}</div>`;
  return `
    <div class="pcol">
      <div class="pcol-head">
        <h3>${title}</h3>
        <button class="tiny" data-action="merge-same" data-col="${col}">合并同类项</button>
      </div>
      <div class="pcol-body">${hint}${body}</div>
    </div>`;
}
function purchaseRowHTML(col, r) {
  const src = state.purchaseMergeSrc && state.purchaseMergeSrc.col === col && state.purchaseMergeSrc.id === r.id;
  return `
    <div class="prow ${r.done ? 'done' : ''} ${src ? 'merge-src' : ''}" data-pid="${r.id}">
      <input type="checkbox" ${r.done ? 'checked' : ''} data-action="p-toggle" data-col="${col}" data-id="${r.id}">
      <input class="pname" data-col="${col}" data-id="${r.id}" value="${escAttr(r.name)}" placeholder="名称">
      <input class="pqty" type="number" step="0.5" data-col="${col}" data-id="${r.id}" value="${r.qty == null ? '' : r.qty}" placeholder="数量">
      <input class="punit" data-col="${col}" data-id="${r.id}" value="${escAttr(r.unit)}" placeholder="单位">
      <button class="pmerge" data-action="p-merge" data-col="${col}" data-id="${r.id}">合并</button>
      <button class="px" data-action="p-del" data-col="${col}" data-id="${r.id}" title="删除">×</button>
    </div>`;
}
function purchaseText() {
  const L = state.purchaseList; if (!L) return '';
  const fmt = (rows) => rows.map(r => `- ${r.name}${r.qty != null ? ' ' + r.qty + (r.unit || '') : ''}`).join('\n');
  return `【食材清单】\n${fmt(L.ingredients) || '（空）'}\n\n【调味料清单】\n${fmt(L.seasonings) || '（空）'}`;
}

/* ---------------- 分类筛选 ---------------- */
function renderFilter() {
  setChrome('菜谱分类筛选', '');
  const f = state.filter;
  const catChips = CATEGORY_TAGS.map(t =>
    `<span class="chip ${f.cat.includes(t) ? 'on' : ''}" data-action="filter-toggle" data-type="cat" data-tag="${escAttr(t)}">${t}</span>`).join('');
  const cookChips = COOKING_TAGS.map(t =>
    `<span class="chip cook ${f.cook.includes(t) ? 'on' : ''}" data-action="filter-toggle" data-type="cook" data-tag="${escAttr(t)}">${t}</span>`).join('');

  let results = state.recipes;
  if (f.cat.length) results = results.filter(r => r.categories.some(c => f.cat.includes(c)));
  if (f.cook.length) results = results.filter(r => r.cookings.some(c => f.cook.includes(c)));

  const grid = results.length ? `<div class="grid">${results.map(recipeCardHTML).join('')}</div>`
    : `<div class="empty">没有符合条件的菜谱</div>`;

  $('content').innerHTML = `
    <div class="filter-bar">
      <div class="filter-group">
        <div class="filter-label">菜品分类</div>
        <div class="filter-tags">${catChips}</div>
      </div>
      <div class="filter-group">
        <div class="filter-label">烹饪方式</div>
        <div class="filter-tags">${cookChips}</div>
      </div>
      <div class="filter-label" style="color:var(--text-3)">已选：${f.cat.concat(f.cook).length ? (f.cat.join('、') + (f.cook.length ? ' ＋ ' + f.cook.join('、') : '')) : '全部'}</div>
    </div>
    ${grid}`;
}

/* ---------------- 营养占位 ---------------- */
function renderNutrition() {
  setChrome('营养热量测算', '');
  $('content').innerHTML = `
    <div class="placeholder">
      <div class="ico">🔥</div>
      <h2>营养热量测算</h2>
      <p>规划对接「薄荷健康」开放能力，支持按菜谱自动统计三大营养素（蛋白质 / 碳水 / 脂肪）与热量。<br>首期工作台聚焦菜谱专区，本模块即将上线。</p>
    </div>`;
}

/* ---------------- 事件：点击 ---------------- */
async function handleClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const a = t.dataset.action;

  if (a === 'modal-close') {
    // 只有直接点中“关闭元素本身”（遮罩背景 / 关闭按钮 / 放大图）才关闭，
    // 点到弹窗内部内容（如裁剪框）不关闭，否则拖拽裁剪框会被误关。
    if (e.target === t || e.target.classList.contains('modal-img')) {
      if (cropCtx) { const s = cropCtx.onSkip; const c = cropCtx._cleanup; cropCtx = null; if (c) c(); if (s) s(); }
      closeModal();
    }
    return;
  }
  if (a === 'crop-confirm') { cropConfirm(); return; }
  if (a === 'crop-original') { if (cropCtx) cropCtx.finish(cropCtx.src); return; }

  switch (a) {
    case 'open-editor-new': openEditor(null); break;
    case 'view-recipe': renderRecipeView(t.dataset.id); break;
    case 'back-library': state.viewId = null; renderLibrary(); break;
    case 'edit-recipe': openEditor(t.dataset.id); break;
    /* 收藏夹 */
    case 'fav-add': openFavForm('add'); break;
    case 'fav-edit': {
      const c = state.collections.find(x => x.id === t.dataset.id); if (!c) break;
      openFavForm('edit', c); break;
    }
    case 'fav-save': {
      const urlEl = document.getElementById('favUrl');
      const url = urlEl ? urlEl.value.trim() : '';
      if (!url) { toast('请先粘贴视频链接'); break; }
      const titleEl = document.getElementById('favTitle');
      const rawEl = document.getElementById('favRaw');
      const noteEl = document.getElementById('favNote');
      const c = {
        id: uid(), title: titleEl ? titleEl.value.trim() : '', url,
        cover: favCoverImg || '', raw: rawEl ? rawEl.value : '', note: noteEl ? noteEl.value.trim() : '',
        createdAt: Date.now(), recipeId: null, converted: false,
      };
      state.collections.push(c);
      save(); closeModal(); favCoverImg = '';
      renderFavorites(); break;
    }
    case 'fav-update': {
      const c = state.collections.find(x => x.id === t.dataset.id); if (!c) break;
      const urlEl = document.getElementById('favUrl');
      const url = urlEl ? urlEl.value.trim() : '';
      if (!url) { toast('请先粘贴视频链接'); break; }
      const titleEl = document.getElementById('favTitle');
      const rawEl = document.getElementById('favRaw');
      const noteEl = document.getElementById('favNote');
      c.title = titleEl ? titleEl.value.trim() : '';
      c.url = url; c.cover = favCoverImg || '';
      c.raw = rawEl ? rawEl.value : ''; c.note = noteEl ? noteEl.value.trim() : '';
      save(); closeModal(); favCoverImg = '';
      renderFavorites(); break;
    }
    case 'fav-open': {
      const c = state.collections.find(x => x.id === t.dataset.id); if (!c) break;
      if (!c.url) { toast('该收藏没有视频链接'); break; }
      openVideoModal(c.url); break;
    }
    case 'fav-del': requestDelete('fav', t.dataset.id); break;
    case 'fav-convert': {
      const c = state.collections.find(x => x.id === t.dataset.id); if (!c) break;
      const r = convertFavorite(c);
      openEditor(r.id); break;
    }
    case 'fav-view': {
      const c = state.collections.find(x => x.id === t.dataset.id);
      if (!c || !favRecipeExists(c)) { toast('该菜谱已被删除，可重新转换'); renderFavorites(); break; }
      state.view = 'library'; state.editing = null; state.viewId = c.recipeId; render(); break;
    }
    case 'del-recipe': requestDelete('recipe', t.dataset.id); break;
    case 'do-delete': {
      const kind = t.dataset.kind, id = t.dataset.did;
      if (kind === 'recipe') {
        const r = getRecipe(id);
        if (r) {
          state.recipes = state.recipes.filter(x => x.id !== id);
          save(); closeModal(); renderLibrary();
          toast('已删除菜谱「' + (r.name || '未命名') + '」');
        }
      } else if (kind === 'fav') {
        const c = state.collections.find(x => x.id === id);
        if (c) {
          state.collections = state.collections.filter(x => x.id !== id);
          save(); closeModal(); renderFavorites();
          toast('已删除收藏「' + (c.title || '未命名') + '」');
        }
      }
      break;
    }
    case 'save': saveEditor(); break;
    case 'cancel': cancelEditor(); break;
    case 'discard-edit': closeModal(); doCancelEdit(); break;
    /* 云端同步 */
    case 'open-sync': openSyncModal(); break;
    case 'sync-test': {
      const tok = document.getElementById('syncToken').value.trim();
      const repo = document.getElementById('syncRepo').value.trim();
      const st = document.getElementById('syncStatus');
      if (!tok || !repo) { st.textContent = '请先填写令牌和仓库'; st.className = 'sync-status err'; break; }
      st.textContent = '连接中…'; st.className = 'sync-status';
      fetch('https://api.github.com/repos/' + repo, { headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json' } })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(j => { st.textContent = '✅ 连接成功：' + (j.full_name || repo); st.className = 'sync-status ok'; })
        .catch(e => { st.textContent = '❌ 失败：' + e.message; st.className = 'sync-status err'; });
      break;
    }
    case 'sync-pull':
      closeModal();
      githubPull().then(() => toast('已从云端拉取')).catch(e => toast('拉取失败：' + e.message));
      break;
    case 'sync-save': {
      const cfg = {
        token: document.getElementById('syncToken').value.trim(),
        repo: document.getElementById('syncRepo').value.trim(),
        branch: document.getElementById('syncBranch').value.trim() || 'main',
        path: document.getElementById('syncPath').value.trim() || 'data.json',
        auto: document.getElementById('syncAuto').checked,
      };
      setSyncCfg(cfg); closeModal();
      if (cfg.token && cfg.repo) {
        updateSyncDot('busy');
        githubPush().then(() => toast('同步设置已保存，已上传到云端')).catch(e => toast('上传失败：' + e.message));
      } else toast('同步设置已保存（未填写令牌，暂不启用）');
      break;
    }

    case 'toggle-tag': {
      const arr = t.dataset.type === 'cat' ? state.editing.categories : state.editing.cookings;
      const tag = t.dataset.tag;
      const i = arr.indexOf(tag);
      if (i >= 0) arr.splice(i, 1); else arr.push(tag);
      refreshHeader();
      break;
    }
    case 'cover-upload':
    case 'cover-camera': {
      const files = await pickFiles({ multiple: false, capture: a === 'cover-camera' });
      if (files && files[0]) {
        const src = await compressImage(files[0], 1280, 0.82);
        openCrop(null, null, src, (out) => { state.editing.cover = out; refreshHeader(); });
      }
      break;
    }
    case 'cover-del': state.editing.cover = null; refreshHeader(); break;
    case 'cover-enlarge': if (state.editing.cover) showImage(state.editing.cover); break;
    case 'open-video': {
      const liveEl = document.getElementById('f-video');
      const url = (liveEl && liveEl.value.trim()) || state.editing.videoUrl;
      if (url) openVideoModal(url); else toast('请先填写来源视频链接');
      break;
    }
    case 'open-url': {
      const url = t.dataset.url;
      const w = window.open(url, '_blank', 'noopener');
      if (!w) toast('已弹出复制提示，请在浏览器打开'); else toast('正在打开…');
      break;
    }
    case 'copy-url': copyText(t.dataset.url); break;

    case 'batch-parse': batchParse(t.dataset.sec); break;
    case 'add-item': {
      const arr = state.editing.sections[t.dataset.sec];
      arr.push(SECTIONS.find(s => s.key === t.dataset.sec).structured ? blankItem() : { id: uid(), kind: 'item', text: '', images: [] });
      refreshSection(t.dataset.sec);
      break;
    }
    case 'ins-note-above': case 'ins-note-below': {
      const arr = state.editing.sections[t.dataset.sec];
      const i = arr.findIndex(b => b.id === t.dataset.bid);
      const at = a === 'ins-note-above' ? i : i + 1;
      arr.splice(at, 0, blankNote());
      refreshSection(t.dataset.sec);
      break;
    }
    case 'add-image': {
      const files = await pickFiles({ multiple: true });
      if (files && files.length) {
        const imgs = [];
        for (const f of files) imgs.push(await compressImage(f, 1600, 0.8));
        startCropQueue(t.dataset.sec, t.dataset.bid, imgs);
      }
      break;
    }
    case 'move-up': case 'move-down': {
      const arr = state.editing.sections[t.dataset.sec];
      const i = arr.findIndex(b => b.id === t.dataset.bid);
      const j = a === 'move-up' ? i - 1 : i + 1;
      if (j >= 0 && j < arr.length) { [arr[i], arr[j]] = [arr[j], arr[i]]; refreshSection(t.dataset.sec); }
      break;
    }
    case 'del-block': {
      const arr = state.editing.sections[t.dataset.sec];
      const i = arr.findIndex(b => b.id === t.dataset.bid);
      arr.splice(i, 1); refreshSection(t.dataset.sec);
      break;
    }
    case 'del-image': {
      const b = findBlock(t.dataset.sec, t.dataset.bid);
      b.images.splice(+t.dataset.idx, 1); refreshSection(t.dataset.sec);
      break;
    }
    case 'enlarge': {
      const b = findBlock(t.dataset.sec, t.dataset.bid);
      const src = b.images[+t.dataset.idx];
      if (src) showImage(src);
      break;
    }
    case 'enlarge-view': {
      const r = getRecipe(state.viewId);
      const b = r.sections.ingredients.concat(r.sections.seasonings, r.sections.steps).find(x => x.id === t.dataset.bid);
      const src = b && b.images[+t.dataset.idx];
      if (src) showImage(src);
      break;
    }

    // 分量（查看页）：重置
    case 'portion-reset': {
      const r = getRecipe(state.viewId); if (!r) break;
      r.scaleBase = null; r.scaleAmount = null; save();
      renderRecipeView(r.id); break;
    }
    // 分量（采购页）：重置
    case 'p-portion-reset': {
      const r = getRecipe(t.dataset.id); if (!r) break;
      r.scaleBase = null; r.scaleAmount = null; save();
      if (state.purchaseSelected.includes(r.id)) recomputePurchase();
      renderPurchase(); break;
    }
    // 分量（查看页）：确认按比例调整
    case 'portion-confirm': {
      const r = getRecipe(state.viewId); if (!r) break;
      const opts = baseIngredientOptions(r);
      if (!opts.length) { toast('该菜谱没有可用的基准食材'); break; }
      if (!r.scaleBase) r.scaleBase = opts[0].id;
      if (r.scaleAmount == null || isNaN(r.scaleAmount)) { toast('请输入目标用量'); break; }
      save(); refreshViewScaled(r); toast('已按比例调整分量'); break;
    }
    // 分量（采购页）：确认按比例调整
    case 'p-portion-confirm': {
      const r = getRecipe(t.dataset.id); if (!r) break;
      const opts = baseIngredientOptions(r);
      if (!opts.length) { toast('该菜谱没有可用的基准食材'); break; }
      if (!r.scaleBase) r.scaleBase = opts[0].id;
      if (r.scaleAmount == null || isNaN(r.scaleAmount)) { toast('请输入目标用量'); break; }
      save();
      if (state.purchaseSelected.includes(r.id)) recomputePurchase();
      refreshPurchaseList(); toast('已按比例调整分量'); break;
    }

    // 采购选择（实时）
    case 'sel-toggle': {
      const id = t.dataset.id;
      const i = state.purchaseSelected.indexOf(id);
      if (i >= 0) state.purchaseSelected.splice(i, 1); else state.purchaseSelected.push(id);
      recomputePurchase();
      renderPurchase();
      break;
    }
    case 'p-recompute': recomputePurchase(); renderPurchase(); break;
    case 'p-toggle': { const r = getProw(t.dataset.col, t.dataset.id); if (r) r.done = !r.done; renderPurchase(); break; }
    case 'p-del': {
      state.purchaseList[t.dataset.col] = state.purchaseList[t.dataset.col].filter(r => r.id !== t.dataset.id);
      if (state.purchaseMergeSrc && state.purchaseMergeSrc.id === t.dataset.id) state.purchaseMergeSrc = null;
      renderPurchase();
      break;
    }
    case 'p-merge': {
      const col = t.dataset.col, id = t.dataset.id;
      if (!state.purchaseMergeSrc) {
        state.purchaseMergeSrc = { col, id };
      } else if (state.purchaseMergeSrc.col === col && state.purchaseMergeSrc.id === id) {
        state.purchaseMergeSrc = null;
      } else {
        const src = getProw(state.purchaseMergeSrc.col, state.purchaseMergeSrc.id);
        const tgt = getProw(col, id);
        if (src && tgt) {
          if (tgt.qty != null) src.qty = (src.qty || 0) + tgt.qty;
          if (!src.unit && tgt.unit) src.unit = tgt.unit;
          src.name = src.name || tgt.name;
          state.purchaseList[col] = state.purchaseList[col].filter(r => r.id !== id);
        }
        state.purchaseMergeSrc = null;
        toast('已合并');
      }
      renderPurchase();
      break;
    }
    case 'p-selall': state.purchaseList.ingredients.concat(state.purchaseList.seasonings).forEach(r => r.done = true); renderPurchase(); break;
    case 'p-clear': state.purchaseList.ingredients.concat(state.purchaseList.seasonings).forEach(r => r.done = false); renderPurchase(); break;
    case 'p-copy': copyText(purchaseText()); break;
    case 'p-export': downloadText('采购清单.txt', purchaseText()); break;
    case 'merge-same': mergeSameName(t.dataset.col); state.purchaseMergeSrc = null; renderPurchase(); break;

    // 筛选
    case 'filter-toggle': {
      const arr = t.dataset.type === 'cat' ? state.filter.cat : state.filter.cook;
      const tag = t.dataset.tag;
      const i = arr.indexOf(tag);
      if (i >= 0) arr.splice(i, 1); else arr.push(tag);
      renderFilter();
      break;
    }

    /* 备菜板块 */
    case 'add-prep-group': {
      const prep = state.editing.sections.prep;
      const title = prep.length === 0 ? '单独' : '备菜' + prep.length;
      prep.push({ id: uid(), title, members: [] });
      refreshSection('prep');
      break;
    }
    case 'prep-del-group': {
      state.editing.sections.prep = state.editing.sections.prep.filter(g => g.id !== t.dataset.gid);
      refreshSection('prep');
      break;
    }
    case 'prep-add-member': openPrepPicker(t.dataset.gid); break;
    case 'prep-del-member': {
      const g = findPrepGroup(t.dataset.gid);
      if (g) g.members = g.members.filter(m => m.refId !== t.dataset.ref);
      refreshSection('prep');
      break;
    }
    case 'prep-pick-confirm': {
      const g = findPrepGroup(t.dataset.gid);
      if (g) {
        const checked = new Set([...document.querySelectorAll('.prep-pick input:checked')].map(c => c.dataset.ref));
        const oldForm = new Map(g.members.map(m => [m.refId, m.form]));
        g.members = [...checked].map(ref => ({ refId: ref, form: oldForm.get(ref) || '' }));
      }
      closeModal();
      refreshSection('prep');
      break;
    }
  }
}

/* ---------------- 事件：输入 ---------------- */
function handleInput(e) {
  const t = e.target;
  if (t.id === 'searchBox') {
    state.search = t.value;
    if (state.view !== 'library') navigate('library');
    else renderLibrary();
    return;
  }
  if (t.id === 'f-name') { state.editing.name = t.value; return; }
  if (t.id === 'f-video') { state.editing.videoUrl = t.value.trim(); return; }
  if (t.classList.contains('rname')) { const b = findBlock(t.dataset.sec, t.dataset.bid); if (b) { b.name = t.value; syncText(b); } return; }
  if (t.classList.contains('ramount')) { const b = findBlock(t.dataset.sec, t.dataset.bid); if (b) { b.amount = t.value === '' ? null : parseFloat(t.value); syncText(b); } return; }
  if (t.classList.contains('runit')) { const b = findBlock(t.dataset.sec, t.dataset.bid); if (b) { b.unit = t.value; syncText(b); } return; }
  if (t.classList.contains('rnote') || t.classList.contains('rsteptext')) { const b = findBlock(t.dataset.sec, t.dataset.bid); if (b) b.text = t.value; return; }
  if (t.classList.contains('pname')) { const r = getProw(t.dataset.col, t.dataset.id); if (r) r.name = t.value; return; }
  if (t.classList.contains('pqty')) { const r = getProw(t.dataset.col, t.dataset.id); if (r) r.qty = t.value === '' ? null : parseFloat(t.value); return; }
  if (t.classList.contains('punit')) { const r = getProw(t.dataset.col, t.dataset.id); if (r) r.unit = t.value; return; }
  if (t.classList.contains('prep-g-title')) { const g = findPrepGroup(t.dataset.gid); if (g) g.title = t.value; return; }
  if (t.classList.contains('pm-qty')) { const g = findPrepGroup(t.dataset.gid); const m = g && g.members.find(x => x.refId === t.dataset.ref); if (m) m.qty = t.value === '' ? null : parseFloat(t.value); return; }
  if (t.classList.contains('pm-unit')) { const g = findPrepGroup(t.dataset.gid); const m = g && g.members.find(x => x.refId === t.dataset.ref); if (m) m.unit = t.value; return; }
  if (t.classList.contains('pm-form')) { const g = findPrepGroup(t.dataset.gid); const m = g && g.members.find(x => x.refId === t.dataset.ref); if (m) m.form = t.value; return; }
  if (t.dataset.action === 'portion-amt') {
    const r = getRecipe(state.viewId); if (!r) return;
    const v = t.value === '' ? null : parseFloat(t.value);
    r.scaleAmount = (v == null || isNaN(v)) ? null : v;
    save(); return;
  }
  if (t.dataset.action === 'p-portion-amt') {
    const r = getRecipe(t.dataset.id); if (!r) return;
    const v = t.value === '' ? null : parseFloat(t.value);
    r.scaleAmount = (v == null || isNaN(v)) ? null : v;
    save(); return;
  }
}

/* ---------------- 批量识别 / OCR ---------------- */
function batchParse(key) {
  const ta = document.querySelector(`.batch-input[data-sec="${key}"]`);
  if (!ta) return;
  const lines = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { toast('请输入或粘贴内容'); return; }
  const meta = SECTIONS.find(s => s.key === key);
  const arr = state.editing.sections[key];
  lines.forEach(line => {
    if (meta.structured) {
      const m = parseMaterial(line);
      arr.push({ id: uid(), kind: 'item', name: m.name, amount: m.qty, unit: m.unit, text: line, images: [] });
    } else {
      arr.push({ id: uid(), kind: 'item', text: line, images: [] });
    }
  });
  ta.value = '';
  refreshSection(key);
  toast(`已分点 ${lines.length} ${meta.structured ? '条' : '步'}`);
}

/* ---------------- 编辑器保存 / 取消 ---------------- */
function saveEditor() {
  const r = state.editing;
  if (!r.name.trim()) { toast('请填写菜谱名称'); const n = $('f-name'); if (n) n.focus(); return; }
  r.updatedAt = Date.now();
  r.name = r.name.trim();
  if (state.editingId) {
    const i = state.recipes.findIndex(x => x.id === state.editingId);
    if (i >= 0) state.recipes[i] = r;
  } else {
    state.recipes.unshift(r);
  }
  save();
  state.editing = null; state.editingId = null;
  renderLibrary();
  toast('菜谱已保存');
}
function cancelEditor() {
  const r = state.editing;
  const dirty = r.name.trim() ||
    Object.values(r.sections).some(arr => arr.some(b => (b.text && b.text.trim()) || (b.name && b.name.trim()) || (b.images && b.images.length)));
  if (dirty) { requestDiscardEdit(); return; }
  doCancelEdit();
}
function doCancelEdit() {
  const ret = state._editReturn || { viewId: null };
  state.editing = null; state.editingId = null; state._editReturn = null;
  state.view = 'library';
  state.viewId = ret.viewId || null;   // 有 viewId 回该菜谱只读页（上一级），否则回列表
  render();
}
/* 放弃修改确认（应用内弹窗，不依赖被沙箱禁用的 confirm） */
function requestDiscardEdit() {
  $('modalRoot').innerHTML = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel del-confirm">
        <div class="modal-head">放弃修改<span class="modal-close" data-action="modal-close">×</span></div>
        <div class="del-confirm-text">确定放弃未保存的修改吗？<br>此操作不可撤销。</div>
        <div class="modal-actions">
          <button class="btn" data-action="modal-close">继续编辑</button>
          <button class="btn danger" data-action="discard-edit">放弃</button>
        </div>
      </div>
    </div>`;
}

/* ---------------- 拖拽排序 ---------------- */
function cleanupDrag() {
  document.querySelectorAll('.ritem.drop-target,.ritem.dragging').forEach(x => x.classList.remove('drop-target', 'dragging'));
  dragSrc = null;
}
function initDrag() {
  const content = $('content');
  content.addEventListener('mousedown', (e) => {
    const grip = e.target.closest('.grip');
    if (grip) { const row = grip.closest('[data-row]'); if (row) row.setAttribute('draggable', 'true'); }
  });
  document.addEventListener('mouseup', () => {
    document.querySelectorAll('[data-row][draggable="true"]').forEach(b => b.removeAttribute('draggable'));
  });
  content.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    dragSrc = { sec: row.dataset.sec, bid: row.dataset.bid };
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  content.addEventListener('dragover', (e) => {
    if (!dragSrc) return;
    const row = e.target.closest('[data-row]');
    if (!row || row.dataset.bid === dragSrc.bid) return;
    e.preventDefault();
    document.querySelectorAll('.ritem.drop-target').forEach(x => x.classList.remove('drop-target'));
    row.classList.add('drop-target');
  });
  content.addEventListener('drop', (e) => {
    if (!dragSrc) return;
    const row = e.target.closest('[data-row]');
    if (!row) { cleanupDrag(); return; }
    e.preventDefault();
    const sec = dragSrc.sec;
    const arr = activeRecipe().sections[sec];
    const from = arr.findIndex(x => x.id === dragSrc.bid);
    const T = arr.findIndex(x => x.id === row.dataset.bid);
    if (from < 0 || T < 0 || from === T) { cleanupDrag(); return; }
    const [m] = arr.splice(from, 1);
    const after = e.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    let desired = after ? (from < T ? T : T + 1) : (from < T ? T - 1 : T);
    arr.splice(desired, 0, m);
    cleanupDrag();
    refreshSection(sec);
  });
  content.addEventListener('dragend', cleanupDrag);
}

/* ---------------- 初始化 ---------------- */
function ensureUnitList() {
  if (document.getElementById('unit-list')) return;
  const dl = document.createElement('datalist');
  dl.id = 'unit-list';
  dl.innerHTML = UNIT_OPTIONS.filter(u => u).map(u => `<option value="${escAttr(u)}">`).join('');
  document.body.appendChild(dl);
}
/* 输入完用量后，自动聚焦单位框并弹出联想选择 */
function handleChange(e) {
  const t = e.target;
  if (t.classList && t.classList.contains('ramount') && t.value !== '') {
    const unit = t.closest('.rline') && t.closest('.rline').querySelector('.runit');
    if (unit) unit.focus();
  }
  if (t.dataset.action === 'portion-base') {
    const r = getRecipe(state.viewId); if (!r) return;
    r.scaleBase = t.value; r.scaleAmount = null; save();
    renderRecipeView(r.id); return;
  }
  if (t.dataset.action === 'p-portion-base') {
    const r = getRecipe(t.dataset.id); if (!r) return;
    r.scaleBase = t.value; r.scaleAmount = null; save();
    if (state.purchaseSelected.includes(r.id)) recomputePurchase();
    renderPurchase(); return;
  }
}
function init() {
  load();
  ensureUnitList();
  $('nav').addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (item) navigate(item.dataset.view);
  });
  // 监听绑定在 document 上，覆盖顶栏操作按钮与弹窗（均不在 #content 内）
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  initDrag();
  // 同步状态点：已配置则亮起，自动模式启动即拉取云端（手机/电脑拿同一份）
  if (syncEnabled()) {
    updateSyncDot(getSyncCfg().auto ? 'busy' : 'on');
    if (getSyncCfg().auto) {
      githubPull().catch(e => { updateSyncDot('err'); console.warn('启动拉取失败', e); });
    }
  }
  render();
}
init();
