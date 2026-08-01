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
  favSearch: '',
  purchaseSearch: '',
  filterSearch: '',
  collections: [],
  nutfoods: [],      // 食物营养库：每 100g 的热量(kcal)/蛋白(g)/脂肪(g)/碳水(g)/糖/盐/纤维
  nutView: 'calc',   // nutrition 子视图：calc=菜谱测算 / lib=食物营养库
  nutSelRecipes: [], // 营养测算：选中的菜谱 id（多选共同参与计算）
  nutScale: {},      // recipeId -> { base: 食材id, amount: 实际用量, unit:'g'|'ml' }（基准食材缩放，替代份数）
  nutManual: {},     // "recipeId::name" -> { amt: 用量, unit:'g'|'ml' }（未记录准确用量的食材手动填写）
  nutRecords: [],    // 热量记录
  nutRecView: null,  // 当前查看的记录 id
  nutRecListOpen: false, // 底部「热量记录」历史列表是否展开（默认收起）
};
let dragSrc = null;
let nutAgg = null;       // 最近一次营养聚合结果（供点击宏量元素查看 Top3 来源）
let nutNoFoodList = [];  // 最近一次测算中「查不到营养数据」的食材名（供底部整宽提示区）

/* 内置常见食材营养（每 100g）：热量kcal / 蛋白质g / 脂肪g / 碳水g */
const NUT_SEED = [
  { name: '鸡胸肉', kcal: 133, protein: 19.4, fat: 5, carb: 2.5, fiber: 0 },
  { name: '西兰花', kcal: 34, protein: 4.1, fat: 0.6, carb: 4.3, fiber: 2.6 },
  { name: '番茄', kcal: 18, protein: 0.9, fat: 0.2, carb: 3.9, sugar: 2.6, fiber: 1.2 },
  { name: '鸡蛋', kcal: 144, protein: 13.3, fat: 8.8, carb: 2.8, sodium: 131 },
  { name: '牛肉(瘦)', kcal: 106, protein: 20.2, fat: 2.3, carb: 1.2, sodium: 55 },
  { name: '猪里脊', kcal: 155, protein: 20.2, fat: 7.9, carb: 0.7, sodium: 43 },
  { name: '米饭(熟)', kcal: 116, protein: 2.6, fat: 0.3, carb: 25.9, sugar: 0.3, fiber: 0.3 },
  { name: '面条(熟)', kcal: 110, protein: 3.6, fat: 0.4, carb: 22.4, fiber: 1.2 },
  { name: '土豆', kcal: 77, protein: 2.0, fat: 0.2, carb: 17.2, fiber: 2.2 },
  { name: '胡萝卜', kcal: 41, protein: 1.0, fat: 0.2, carb: 9.6, sugar: 4.7, fiber: 2.8 },
  { name: '黄瓜', kcal: 16, protein: 0.8, fat: 0.2, carb: 2.9, fiber: 0.5 },
  { name: '豆腐', kcal: 76, protein: 8.1, fat: 4.8, carb: 1.9, sodium: 7, fiber: 0.4 },
  { name: '牛奶', kcal: 54, protein: 3.0, fat: 3.2, carb: 3.4, sugar: 4.8, sodium: 43, fiber: 0 },
  { name: '虾', kcal: 93, protein: 18.6, fat: 0.8, carb: 2.8, sodium: 165 },
  { name: '三文鱼', kcal: 139, protein: 17.2, fat: 7.8, carb: 0, sodium: 59, fiber: 0 },
  { name: '燕麦', kcal: 367, protein: 15, fat: 6.7, carb: 61, fiber: 10.6 },
  { name: '香蕉', kcal: 89, protein: 1.1, fat: 0.3, carb: 22.8, sugar: 12.2, fiber: 2.6 },
  { name: '苹果', kcal: 52, protein: 0.3, fat: 0.2, carb: 13.8, sugar: 10.4, fiber: 2.4 },
  { name: '食用油', kcal: 899, protein: 0, fat: 99.9, carb: 0, sodium: 0 },
  { name: '白糖', kcal: 387, protein: 0, fat: 0, carb: 99.9, sugar: 99.9 },
  { name: '生抽', kcal: 20, protein: 2.2, fat: 0.1, carb: 3.0, sodium: 638, fiber: 0.2 },
  { name: '盐', kcal: 0, protein: 0, fat: 0, carb: 0, sodium: 38758 },
  /* ===== 扩展库（常见家常食材，每 100g 参考值；同名食材用户改过的不覆盖） ===== */
  /* 蔬菜 */
  { name: '白菜', kcal: 17, protein: 1.5, fat: 0.1, carb: 3.2 },
  { name: '菠菜', kcal: 28, protein: 2.6, fat: 0.3, carb: 4.5, fiber: 2.2 },
  { name: '生菜', kcal: 15, protein: 1.4, fat: 0.2, carb: 2.9 },
  { name: '油麦菜', kcal: 15, protein: 1.4, fat: 0.2, carb: 2.9 },
  { name: '芹菜', kcal: 17, protein: 0.7, fat: 0.2, carb: 3.9 },
  { name: '韭菜', kcal: 29, protein: 2.4, fat: 0.4, carb: 4.6 },
  { name: '青椒', kcal: 22, protein: 1.0, fat: 0.2, carb: 5.4 },
  { name: '红椒', kcal: 31, protein: 1.0, fat: 0.3, carb: 6.0 },
  { name: '彩椒', kcal: 26, protein: 1.0, fat: 0.2, carb: 5.5 },
  { name: '茄子', kcal: 25, protein: 1.0, fat: 0.2, carb: 5.2 },
  { name: '洋葱', kcal: 40, protein: 1.1, fat: 0.1, carb: 9.3 },
  { name: '大葱', kcal: 30, protein: 1.7, fat: 0.3, carb: 6.5 },
  { name: '小葱', kcal: 27, protein: 1.8, fat: 0.2, carb: 5.0 },
  { name: '姜', kcal: 41, protein: 1.8, fat: 0.8, carb: 8.0 },
  { name: '蒜', kcal: 149, protein: 6.4, fat: 0.5, carb: 33 },
  { name: '冬瓜', kcal: 12, protein: 0.4, fat: 0.2, carb: 2.6 },
  { name: '南瓜', kcal: 26, protein: 1.0, fat: 0.1, carb: 6.5 },
  { name: '西葫芦', kcal: 18, protein: 1.0, fat: 0.2, carb: 3.5 },
  { name: '苦瓜', kcal: 19, protein: 1.0, fat: 0.2, carb: 4.0 },
  { name: '莲藕', kcal: 74, protein: 2.6, fat: 0.1, carb: 17.2 },
  { name: '莴笋', kcal: 15, protein: 1.0, fat: 0.1, carb: 3.0 },
  { name: '香菇', kcal: 26, protein: 2.2, fat: 0.3, carb: 5.2 },
  { name: '金针菇', kcal: 32, protein: 2.4, fat: 0.4, carb: 6.0 },
  { name: '平菇', kcal: 24, protein: 1.9, fat: 0.3, carb: 4.6 },
  { name: '杏鲍菇', kcal: 31, protein: 2.1, fat: 0.2, carb: 6.0 },
  { name: '木耳', kcal: 265, protein: 12, fat: 1.5, carb: 65, fiber: 29 },
  { name: '海带', kcal: 13, protein: 1.2, fat: 0.1, carb: 2.5 },
  /* 肉禽 */
  { name: '鸡腿肉', kcal: 119, protein: 19, fat: 4.4, carb: 0 },
  { name: '鸡翅', kcal: 194, protein: 17, fat: 13, carb: 0 },
  { name: '五花肉', kcal: 508, protein: 7.7, fat: 50, carb: 0 },
  { name: '排骨', kcal: 264, protein: 18, fat: 20, carb: 0 },
  { name: '牛腩', kcal: 332, protein: 17, fat: 28, carb: 0 },
  { name: '羊肉', kcal: 118, protein: 20, fat: 3.9, carb: 0 },
  { name: '鸭肉', kcal: 240, protein: 15, fat: 19, carb: 0 },
  { name: '猪肝', kcal: 129, protein: 19.3, fat: 3.5, carb: 5 },
  { name: '午餐肉', kcal: 229, protein: 9, fat: 15, carb: 15 },
  /* 蛋 */
  { name: '鸭蛋', kcal: 180, protein: 12.6, fat: 13, carb: 1.4 },
  { name: '皮蛋', kcal: 171, protein: 12.6, fat: 10, carb: 4 },
  { name: '鹌鹑蛋', kcal: 160, protein: 12.8, fat: 11, carb: 2.5 },
  /* 水产 */
  { name: '鲫鱼', kcal: 108, protein: 17, fat: 4, carb: 0 },
  { name: '鲈鱼', kcal: 105, protein: 18.6, fat: 3, carb: 0 },
  { name: '带鱼', kcal: 127, protein: 17.7, fat: 4.9, carb: 0 },
  { name: '金枪鱼', kcal: 132, protein: 28, fat: 1, carb: 0 },
  { name: '螃蟹', kcal: 95, protein: 17, fat: 2, carb: 0 },
  { name: '扇贝', kcal: 60, protein: 11, fat: 0.6, carb: 2.5 },
  { name: '鱿鱼', kcal: 92, protein: 15.6, fat: 1.5, carb: 3 },
  { name: '虾仁', kcal: 99, protein: 18, fat: 1.5, carb: 0 },
  { name: '牡蛎', kcal: 73, protein: 9, fat: 2, carb: 4 },
  /* 主食杂粮 */
  { name: '馒头', kcal: 223, protein: 7, fat: 1.1, carb: 47 },
  { name: '面包', kcal: 265, protein: 9, fat: 5, carb: 49 },
  { name: '白粥', kcal: 46, protein: 1.1, fat: 0.3, carb: 10 },
  { name: '玉米', kcal: 106, protein: 4, fat: 1.2, carb: 22 },
  { name: '红薯', kcal: 99, protein: 1.1, fat: 0.2, carb: 24, fiber: 3 },
  { name: '紫薯', kcal: 106, protein: 1.9, fat: 0.2, carb: 25 },
  { name: '山药', kcal: 57, protein: 1.9, fat: 0.2, carb: 13 },
  { name: '芋头', kcal: 79, protein: 2.2, fat: 0.2, carb: 18 },
  { name: '小米', kcal: 361, protein: 9, fat: 3.1, carb: 73 },
  { name: '糙米', kcal: 368, protein: 7.2, fat: 2.9, carb: 76 },
  { name: '绿豆', kcal: 347, protein: 21, fat: 0.8, carb: 62 },
  { name: '红豆', kcal: 324, protein: 20, fat: 0.6, carb: 63 },
  { name: '薏米', kcal: 357, protein: 12, fat: 2, carb: 71 },
  { name: '荞麦', kcal: 337, protein: 9, fat: 2.3, carb: 66 },
  { name: '饺子皮', kcal: 280, protein: 9, fat: 1, carb: 58 },
  { name: '面条', kcal: 355, protein: 11, fat: 1, carb: 75 },
  /* 豆制品 */
  { name: '豆浆', kcal: 31, protein: 3, fat: 1.6, carb: 1.2 },
  { name: '豆干', kcal: 140, protein: 16, fat: 7, carb: 4 },
  { name: '腐竹', kcal: 459, protein: 44, fat: 21, carb: 22 },
  { name: '千张', kcal: 260, protein: 24, fat: 16, carb: 5 },
  { name: '黄豆', kcal: 390, protein: 35, fat: 16, carb: 34 },
  { name: '毛豆', kcal: 131, protein: 13, fat: 5, carb: 11 },
  { name: '豆芽', kcal: 47, protein: 4.5, fat: 1.6, carb: 4.5 },
  { name: '内酯豆腐', kcal: 49, protein: 5, fat: 1.9, carb: 2.9 },
  /* 奶制品 */
  { name: '酸奶', kcal: 72, protein: 3.2, fat: 2.9, carb: 9 },
  { name: '奶酪', kcal: 328, protein: 25, fat: 24, carb: 3 },
  { name: '黄油', kcal: 717, protein: 0.9, fat: 81, carb: 0.1 },
  { name: '淡奶油', kcal: 340, protein: 2, fat: 35, carb: 3 },
  { name: '炼乳', kcal: 331, protein: 8, fat: 8, carb: 54 },
  /* 水果 */
  { name: '橙子', kcal: 47, protein: 0.9, fat: 0.1, carb: 12, sugar: 9 },
  { name: '梨', kcal: 44, protein: 0.4, fat: 0.1, carb: 13, sugar: 9 },
  { name: '葡萄', kcal: 43, protein: 0.5, fat: 0.2, carb: 10, sugar: 10 },
  { name: '西瓜', kcal: 30, protein: 0.6, fat: 0.1, carb: 7.6, sugar: 6.4 },
  { name: '草莓', kcal: 32, protein: 1.0, fat: 0.2, carb: 7.1, sugar: 4.9 },
  { name: '猕猴桃', kcal: 61, protein: 1.1, fat: 0.5, carb: 14, sugar: 9 },
  { name: '桃子', kcal: 39, protein: 0.9, fat: 0.1, carb: 9.5, sugar: 8 },
  { name: '芒果', kcal: 60, protein: 0.8, fat: 0.4, carb: 15, sugar: 14 },
  { name: '蓝莓', kcal: 57, protein: 0.7, fat: 0.3, carb: 14, sugar: 10 },
  { name: '菠萝', kcal: 50, protein: 0.5, fat: 0.1, carb: 12, sugar: 10 },
  { name: '柠檬', kcal: 29, protein: 1.1, fat: 0.3, carb: 9, sugar: 2.5 },
  { name: '柚子', kcal: 41, protein: 0.8, fat: 0.2, carb: 9.5, sugar: 8 },
  /* 坚果 / 油脂 / 糖 / 调料 */
  { name: '花生', kcal: 567, protein: 25, fat: 49, carb: 16 },
  { name: '核桃', kcal: 654, protein: 15, fat: 65, carb: 14 },
  { name: '杏仁', kcal: 579, protein: 21, fat: 50, carb: 22 },
  { name: '腰果', kcal: 553, protein: 18, fat: 44, carb: 30 },
  { name: '瓜子', kcal: 608, protein: 28, fat: 48, carb: 18 },
  { name: '芝麻', kcal: 631, protein: 18, fat: 53, carb: 24 },
  { name: '蜂蜜', kcal: 304, protein: 0.3, fat: 0, carb: 82, sugar: 82 },
  { name: '红糖', kcal: 389, protein: 0.7, fat: 0, carb: 96, sugar: 96 },
  { name: '冰糖', kcal: 400, protein: 0, fat: 0, carb: 100, sugar: 100 },
  { name: '老抽', kcal: 119, protein: 6, fat: 0.1, carb: 20 },
  { name: '醋', kcal: 31, protein: 0.5, fat: 0, carb: 4.9 },
  { name: '蚝油', kcal: 112, protein: 3.5, fat: 0.1, carb: 22 },
  { name: '料酒', kcal: 100, protein: 0.2, fat: 0, carb: 4 },
  { name: '番茄酱', kcal: 82, protein: 1.2, fat: 0.2, carb: 19, sugar: 15 },
  { name: '沙拉酱', kcal: 380, protein: 1.2, fat: 38, carb: 8 },
  { name: '辣椒酱', kcal: 100, protein: 3, fat: 3, carb: 12 },
  { name: '豆瓣酱', kcal: 178, protein: 7, fat: 6, carb: 22 },
  { name: '咖喱块', kcal: 450, protein: 6, fat: 30, carb: 40 },
  { name: '芝麻酱', kcal: 618, protein: 19, fat: 53, carb: 22 },
  { name: '花生酱', kcal: 588, protein: 25, fat: 50, carb: 20 },
  { name: '巧克力', kcal: 546, protein: 4.9, fat: 31, carb: 61, sugar: 50 },
];
/* 厨房单位 → 克 的粗略换算（体积勺按用户给定值：铁勺5 / 瓷勺12 / 茶勺1 克或毫升） */
const UNIT_TO_G = { 'g': 1, 'ml': 1, 'kg': 1000, '公斤': 1000, '斤': 500, '颗': 200, '个': 150, '只': 150, '根': 100, '片': 30, '块': 80, '把': 50, '勺': 12, '铁勺': 5, '瓷勺': 12, '茶勺': 1, '汤匙': 12, '茶匙': 1, '滴': 0.05 };
function unitToGrams(amount, unit) {
  if (amount == null || isNaN(amount)) return null;     // 适量
  const u = UNIT_ALIAS[unit] || unit;
  const factor = UNIT_TO_G[u];
  if (!factor) return null;                              // 未知单位无法折算
  return Math.round(amount * factor * 100) / 100;
}

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
        if (Array.isArray(parsed.nutfoods)) state.nutfoods = parsed.nutfoods.map(migrateNutFood);
        if (Array.isArray(parsed.nutRecords)) state.nutRecords = parsed.nutRecords.map(migrateNutRecord);
      }
      mergeNutSeed();
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
  r.sections.prep.forEach(g => { if (g.img === undefined) g.img = null; });   // 备菜组图片（向后兼容：旧数据默认无图）
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
function blankNutFood() { return { id: uid(), name: '', kcal: '', protein: '', fat: '', carb: '', sugar: '', sodium: '', fiber: '', per: 100 }; }
/* 把 NUT_SEED 里「用户库还没有」的食材补进营养库（同名不覆盖、不动用户已改的数据） */
function mergeNutSeed() {
  if (!Array.isArray(state.nutfoods)) state.nutfoods = [];
  NUT_SEED.forEach(s => {
    if (!s || !s.name) return;
    const n = norm(s.name);
    if (!state.nutfoods.some(f => f && f.name && norm(f.name) === n)) {
      state.nutfoods.push(Object.assign(blankNutFood(), s));
    }
  });
}
function migrateNutFood(f) {
  return {
    id: f.id || uid(),
    name: f.name || '',
    kcal: f.kcal != null ? f.kcal : '',
    protein: f.protein != null ? f.protein : '',
    fat: f.fat != null ? f.fat : '',
    carb: f.carb != null ? f.carb : '',
    sugar: f.sugar != null ? f.sugar : '',
    sodium: f.sodium != null ? f.sodium : '',
    fiber: f.fiber != null ? f.fiber : '',
    per: f.per || 100,
  };
}
function migrateNutRecord(r) {
  return {
    id: r.id || uid(),
    createdAt: r.createdAt || Date.now(),
    date: r.date || null,
    recipes: Array.isArray(r.recipes) ? r.recipes.map(x => ({ id: x.id, name: x.name || '', servings: x.servings != null ? x.servings : 1, factor: x.factor != null ? x.factor : 1 })) : [],
    total: r.total || { kcal: 0, protein: 0, fat: 0, carb: 0, sugar: 0, sodium: 0, fiber: 0 },
    rows: Array.isArray(r.rows) ? r.rows : [],
  };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ recipes: state.recipes, collections: state.collections, nutfoods: state.nutfoods, nutRecords: state.nutRecords })); }
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
  const payload = JSON.stringify({ recipes: state.recipes, collections: state.collections, nutfoods: state.nutfoods, nutRecords: state.nutRecords });
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
  let txt;
  if (j.content) {
    txt = decodeURIComponent(escape(atob(j.content.replace(/\s/g, ''))));
  } else if (j.sha) {
    // GitHub 限制：单文件 >1MB 时 contents 接口不返回 content，需改用 git blob 接口读取
    const bj = await (await githubApi('/git/blobs/' + j.sha)).json();
    if (!bj.content) throw new Error('云端文件读取失败（可能过大或路径不正确：' + syncPath(cfg) + '@' + syncBranch(cfg) + '）');
    txt = decodeURIComponent(escape(atob(bj.content.replace(/\s/g, ''))));
  } else {
    throw new Error('云端文件为空（或路径/分支不正确：' + syncPath(cfg) + '@' + syncBranch(cfg) + '）');
  }
  const data = JSON.parse(txt);
  if (Array.isArray(data.recipes)) state.recipes = data.recipes.map(migrateRecipe);
  if (Array.isArray(data.collections)) state.collections = data.collections.map(migrateCollection);
  if (Array.isArray(data.nutfoods)) state.nutfoods = data.nutfoods.map(migrateNutFood);
  if (Array.isArray(data.nutRecords)) state.nutRecords = data.nutRecords.map(migrateNutRecord);
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
  state.nutfoods = NUT_SEED.map(f => Object.assign(blankNutFood(), f));
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
function openModal(html) { $('modalRoot').innerHTML = html; }
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
  const out = c.toDataURL('image/jpeg', 0.72);
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

/* ---------------- 导航配置（数据驱动，桌面侧栏与手机抽屉共用） ---------------- */
/* 以后加「备忘录 / 行程」等模块，只需在 NAV 里加一个分组即可，两端自动出现 */
const NAV = [
  { title: '我的菜板', items: [
    { view: 'library',   icon: '📖', label: '菜谱库' },
    { view: 'purchase',  icon: '🛒', label: '点菜采购' },
    { view: 'filter',    icon: '🏷️', label: '菜谱分类' },
    { view: 'nutrition', icon: '🔥', label: '营养热量' },
    { view: 'favorites', icon: '📋', label: '菜谱收藏夹' },
  ]},
  { title: '工具', items: [
    { view: '__sync__', icon: '☁️', label: '云端同步' },
  ]},
];

function renderNav() {
  const html = NAV.map(g => `
    <div class="nav-group">
      <div class="nav-group-title">${escHtml(g.title)}</div>
      ${g.items.map(it => `
        <button class="nav-item" data-view="${escAttr(it.view)}">
          <span class="nav-ico">${it.icon}</span><span>${escHtml(it.label)}</span>
        </button>`).join('')}
    </div>`).join('');
  const nav = document.getElementById('nav');
  const drawerNav = document.getElementById('drawerNav');
  if (nav) nav.innerHTML = html;
  if (drawerNav) drawerNav.innerHTML = html;
}

/* 手机端抽屉开关 + 悬浮新增（由 document 级 onChromeClick 统一处理） */
function openDrawer() {
  const d = document.getElementById('drawer'), m = document.getElementById('drawerMask');
  if (d) d.classList.add('open'); if (m) m.classList.add('open');
}
function closeDrawer() {
  const d = document.getElementById('drawer'), m = document.getElementById('drawerMask');
  if (d) d.classList.remove('open'); if (m) m.classList.remove('open');
}
function toggleDrawer() {
  const d = document.getElementById('drawer');
  if (!d) return;
  d.classList.contains('open') ? closeDrawer() : openDrawer();
}
function onChromeClick(e) {
  const navItem = e.target.closest('.nav-item');
  if (navItem) {
    const v = navItem.dataset.view;
    closeDrawer();
    if (!v) return;
    if (v === '__sync__') { openSyncModal(); return; }
    navigate(v);
    return;
  }
  if (e.target.closest('#hamburger')) { toggleDrawer(); return; }
  if (e.target.closest('#drawerMask') || e.target.closest('#drawerClose')) { closeDrawer(); return; }
  if (e.target.closest('#fabAdd')) { openEditor(null); return; }
}

/* ---------------- 路由 / 渲染分发 ---------------- */
function navigate(view) {
  if (view !== 'library') { state.editing = null; state.viewId = null; }
  state.view = view;
  render();
}
function render() {
  document.querySelectorAll('.nav-item').forEach(n => {
    const v = n.dataset.view;
    n.classList.toggle('active', !!v && v !== '__sync__' && v === state.view);
  });
  if (state.view === 'library' && state.editing) { renderEditor(); return; }
  if (state.view === 'library' && state.viewId) { renderRecipeView(state.viewId); return; }
  if (state.view === 'library') { renderLibrary(); return; }
  if (state.view === 'purchase') { renderPurchase(); return; }
  if (state.view === 'filter') { renderFilter(); return; }
  if (state.view === 'nutrition') { rerenderNut(); return; }
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
  setChrome('绵绵的工作台', `<button class="btn primary" data-action="open-editor-new">＋ 新增菜谱</button>`);
  const q = (state.search || '').trim();
  const list = q ? state.recipes.filter(r => recipeMatches(r, q)) : state.recipes;
  const content = $('content');
  const searchBar = `
    <div class="mod-searchbar">
      <span class="search-ico">🔍</span>
      <input id="libSearch" class="search-box" placeholder="搜索本页菜谱（名称 / 食材 / 标签，输入即筛选）" value="${escAttr(state.search || '')}" data-action="lib-search"/>
      ${q ? `<button class="mod-search-clear" data-action="lib-search-clear">✕</button>` : ''}
    </div>`;
  if (!state.recipes.length) {
    content.innerHTML = searchBar + `<div class="empty"><div class="big">🍽️</div>还没有菜谱，点击右上角「新增菜谱」开始记录吧</div>`;
    return;
  }
  if (!list.length) {
    content.innerHTML = searchBar + `<div class="empty"><div class="big">🔍</div>没有找到与「${escHtml(q)}」匹配的菜谱<div class="hint">换个关键词试试，或清空搜索框</div></div>`;
    return;
  }
  const banner = q ? `<div class="search-banner">🔍 搜索「${escHtml(q)}」：${list.length} 道菜谱</div>` : '';
  const hero = q ? '' : heroCardHTML();
  content.innerHTML = searchBar + hero + banner + `<div class="grid">${list.map(recipeCardHTML).join('')}</div>`;
}
function countText(r) {
  const i = r.sections.ingredients.filter(b => b.kind === 'item').length;
  const s = r.sections.seasonings.filter(b => b.kind === 'item').length;
  const p = r.sections.steps.filter(b => b.kind === 'item').length;
  const pr = (r.sections.prep || []).length;
  return `食材 ${i} · 调味料 ${s} · 备菜 ${pr} · 步骤 ${p}`;
}
/* 首页概览卡（参考 趣AI记账 紫色渐变卡 + 快捷按钮 + 分类入口） */
function heroCardHTML() {
  const total = state.recipes.length;
  const favCount = state.collections.length;
  const catIcons = { '禽类': '🐔', '畜类': '🐷', '鱼类': '🐟', '其他水产': '🦐', '素菜': '🥬', '主食类': '🍚', '其他': '🍽️' };
  const cats = CATEGORY_TAGS.map(c =>
    `<button class="qcat" data-action="goto-filter" data-cat="${escAttr(c)}">
       <span class="qcat-ico">${catIcons[c] || '🍴'}</span>
       <span class="qcat-name">${escHtml(c)}</span>
     </button>`).join('');
  return `
  <div class="hero-card">
    <div class="hero-top">
      <div class="hero-info">
        <div class="hero-label">绵绵的菜谱</div>
        <div class="hero-num">${total}</div>
        <div class="hero-sub">道拿手菜 · ${favCount} 条收藏待整理</div>
      </div>
      <div class="hero-emoji">🐱</div>
    </div>
    <div class="hero-actions">
      <button class="hero-btn pink" data-action="open-editor-new">＋ 新增菜谱</button>
      <button class="hero-btn mint" data-action="fav-add">📋 添加收藏</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:16px;color:rgba(255,255,255,.9);font-size:13px;font-weight:600;">
      📋 快捷分类
    </div>
    <div class="qcat-grid">${cats}</div>
  </div>`;
}
/* 分类入口：跳到分类筛选并预选该分类 */
function gotoFilterCat(cat) {
  state.filter = { cat: cat ? [cat] : [], cook: [] };
  navigate('filter');
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
    try { favCoverImg = await compressImage(f, 1280, 0.72); renderFavCoverPreview(); } catch (_) {}
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
  const q = (state.favSearch || '').trim().toLowerCase();
  const list = q ? state.collections.filter(c => (c.title || '').toLowerCase().includes(q) || (c.raw || '').toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q)) : state.collections;
  const searchBar = `
    <div class="mod-searchbar">
      <span class="search-ico">🔍</span>
      <input id="favSearch" class="search-box" placeholder="搜索收藏（标题 / 正文 / 备注，输入即筛选）" value="${escAttr(state.favSearch || '')}" data-action="fav-search"/>
      ${q ? `<button class="mod-search-clear" data-action="fav-search-clear">✕</button>` : ''}
    </div>`;
  if (!state.collections.length) {
    content.innerHTML = searchBar + `<div class="empty"><div class="big">📋</div>收藏夹还是空的<div class="hint">把抖音 / 小红书的视频链接粘贴进来：点卡片即可跳转看视频，也能一键转成菜谱库里的菜（视频会作为来源挂在菜谱上，方便边看边填用料和步骤）</div></div>`;
    return;
  }
  const shown = list.length ? `<div class="grid">${list.map(favCardHTML).join('')}</div>` : `<div class="empty"><div class="big">🔍</div>没有找到与「${escHtml(state.favSearch)}」匹配的收藏</div>`;
  content.innerHTML = searchBar + shown;
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
    const imgHTML = g.img ? `<div class="v-thumb" style="background-image:url('${escAttr(g.img)}')" data-action="enlarge-prep-img" data-gid="${escAttr(g.id)}"></div>` : '';
    return `<div class="view-group"><div class="view-group-title"><span class="vgt-pill">${escHtml(g.title || '备菜')}</span>${imgHTML}</div><div class="view-list cols">${members || '<div class="view-empty">（无）</div>'}</div></div>`;
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
    const hasImgCls = imgs ? ' has-img' : '';
    return `<div class="view-step${hasImgCls}"><span class="step-no">${stepNo}</span><span class="step-text">${escHtml(b.text)}</span>${imgs}</div>`;
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
    <div class="ritem mat" data-row data-sec="${key}" data-bid="${b.id}" tabindex="0">
      <div class="rline">
        <span class="grip" title="按住拖拽排序">⠿</span>
        <span class="idx">${i + 1}</span>
        <input class="rname" ${listAttr} data-sec="${key}" data-bid="${b.id}" value="${escAttr(b.name || '')}" placeholder="名称">
        <input class="ramount" type="number" step="0.5" data-sec="${key}" data-bid="${b.id}" value="${b.amount == null ? '' : b.amount}" placeholder="用量">
        <input class="runit" list="unit-list" data-sec="${key}" data-bid="${b.id}" value="${escAttr(b.unit || '')}" placeholder="单位">
      </div>
      <div class="r-imgs">${imgs}</div>
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
    <div class="ritem step" data-row data-sec="${key}" data-bid="${b.id}" tabindex="0">
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
  const imgBox = `<div class="prep-g-img ${g.img ? 'has' : ''}" data-action="prep-group-img" data-gid="${g.id}" style="${g.img ? `background-image:url('${escAttr(g.img)}')` : ''}">${g.img ? '' : '＋ 图片'}</div>`;
  return `
    <div class="prep-group">
      <div class="prep-group-head">
        <input class="prep-g-title" data-gid="${g.id}" value="${escAttr(g.title || '')}" placeholder="备菜组名称">
        ${imgBox}
        <button class="tiny danger" data-action="prep-del-group" data-gid="${g.id}">删除组</button>
      </div>
      ${g.img ? `<button class="tiny danger prep-g-img-del" data-action="prep-group-img-del" data-gid="${g.id}">删除图片</button>` : ''}
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
  const q = (state.purchaseSearch || '').trim().toLowerCase();
  if (!state.purchaseSelected.length && !state.purchaseList) { /* fallthrough */ }
  const selList = recipes.filter(r => !q || (r.name || '').toLowerCase().includes(q) || r.categories.join('/').toLowerCase().includes(q) || r.cookings.join('/').toLowerCase().includes(q)).map(r => {
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

  const searchBar = `
    <div class="mod-searchbar">
      <span class="search-ico">🔍</span>
      <input id="purSearch" class="search-box" placeholder="搜索本页菜谱（名称 / 分类，输入即筛选）" value="${escAttr(state.purchaseSearch || '')}" data-action="pur-search"/>
      ${q ? `<button class="mod-search-clear" data-action="pur-search-clear">✕</button>` : ''}
    </div>`;

  content.innerHTML = `
    ${searchBar}
    <div class="section-head">
      <div><span class="section-title">选择菜谱</span><span class="section-sub">勾选即实时汇总采购清单；每行可选基准食材并调整分量</span></div>
    </div>
    <div class="select-list">${selList || '<div class="empty">暂无匹配的菜谱</div>'}</div>
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
  // 多选标签时要求“同时满足”所有选中标签（AND 逻辑）：选中多个标签只显示全部带有的菜谱
  if (f.cat.length) results = results.filter(r => f.cat.every(t => r.categories.includes(t)));
  if (f.cook.length) results = results.filter(r => f.cook.every(t => r.cookings.includes(t)));
  const q = (state.filterSearch || '').trim().toLowerCase();
  if (q) results = results.filter(r => (r.name || '').toLowerCase().includes(q) || r.categories.join('/').toLowerCase().includes(q));

  const grid = results.length ? `<div class="grid">${results.map(recipeCardHTML).join('')}</div>`
    : `<div class="empty">没有符合条件的菜谱</div>`;

  const searchBar = `
    <div class="mod-searchbar">
      <span class="search-ico">🔍</span>
      <input id="filterSearch" class="search-box" placeholder="在当前分类结果中搜索菜谱（输入即筛选）" value="${escAttr(state.filterSearch || '')}" data-action="filter-search"/>
      ${q ? `<button class="mod-search-clear" data-action="filter-search-clear">✕</button>` : ''}
    </div>`;

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
    ${searchBar}
    ${grid}`;
}

/* ==================== 营养热量模块 ==================== */
function findNutFood(name) {
  if (!name) return null;
  const n = norm(name);
  return state.nutfoods.find(f => norm(f.name) === n) || null;
}

/* 「记录过准确用量」判定：单位必须是 g 或 ml 且填了数值（其它单位个/勺/适量等一律视为未准确记录） */
function nutIsAccurate(b) {
  if (!b || b.kind !== 'item' || !b.name) return false;
  const u = String(b.unit || '').toLowerCase();
  return (u === 'g' || u === 'ml') && b.amount != null && !isNaN(b.amount);
}
/* 可作「基准食材」的候选：记录过准确用量（g / ml 且有数值）的用料项 */
function nutBaseOptions(r) {
  return (r.sections.ingredients || []).concat(r.sections.seasonings || []).filter(nutIsAccurate);
}
/* 未记录准确用量的用料项（单位不是 g / ml，例如个 / 勺 / 适量 / 未知单位），系统自动识别并放进下拉框手动填 */
function nutImpreciseOptions(r) {
  return (r.sections.ingredients || []).concat(r.sections.seasonings || []).filter(b => b.kind === 'item' && b.name && !nutIsAccurate(b));
}
/* 菜谱“写成时”的总重量（所有食材+调味料中可折算成克的用量之和，单位 g）；个/勺/适量等无克重的不计入 */
function nutTotalWeight(r) {
  let total = 0;
  (r.sections.ingredients || []).concat(r.sections.seasonings || []).forEach(b => {
    if (b.kind !== 'item' || !b.name) return;
    if (nutIsAccurate(b)) { const g = unitToGrams(b.amount, b.unit); if (g != null) total += g; }
  });
  return total;
}
/* 推算整道菜缩放倍率（替代份数）：
 *  - 基准食材模式（默认）：按「基准食材实际用量 ÷ 基准记录克重」等比缩放；
 *  - 基准份量模式：按「实际克重 ÷ 总重量」等比缩放热量。 */
function nutScaleFactorOf(r) {
  const sc = state.nutScale[r.id];
  if (!sc) return 1;
  if (sc.mode === 'portion') {
    const total = nutTotalWeight(r);
    const actual = sc.actual;
    if (!total || total <= 0 || actual == null || isNaN(actual) || actual <= 0) return 1;
    return actual / total;
  }
  if (!sc.base || sc.amount == null || isNaN(sc.amount) || sc.amount <= 0) return 1;
  const base = (r.sections.ingredients || []).concat(r.sections.seasonings || []).find(b => b.id === sc.base && b.kind === 'item');
  if (!base) return 1;
  const baseG = unitToGrams(base.amount, base.unit);
  if (baseG == null) return 1;
  const actualG = unitToGrams(sc.amount, sc.unit || 'g');
  if (actualG == null) return 1;
  return actualG / baseG;
}
/* 收集某菜谱手动填写的克数：{ 食材名: 克数 } */
function nutManualMap(r) {
  const m = {};
  Object.keys(state.nutManual).forEach(k => {
    if (!k.startsWith(r.id + '::')) return;
    const e = state.nutManual[k];
    if (e && e.amt != null && !isNaN(e.amt) && e.amt > 0) m[k.slice((r.id + '::').length)] = +e.amt;
  });
  return m;
}
/* 把某菜谱的手动填写序列化成可存进记录的结构 */
function nutManualForRecord(r) {
  const out = {};
  Object.keys(state.nutManual).forEach(k => {
    if (!k.startsWith(r.id + '::')) return;
    const e = state.nutManual[k];
    if (e && e.amt != null) out[k.slice((r.id + '::').length)] = { amt: e.amt, unit: e.unit || 'g' };
  });
  return out;
}

/* 计算某菜谱营养：遍历食材，按用量折算成「克」再按 100g 基准累加
 * opts.factor：缩放倍率（营养测算用「基准食材实际用量」推算，替代份数）；缺省时沿用 scaleFactorOf * servings
 * opts.gramsOverride：{ "食材名": 克数 }，用于「适量/未知单位」等无法自动折算的用料手动填克数
 * 返回 pending（没用量且未手动填）/ noFood（有用量但营养库查不到）供界面提示 */
function computeRecipeNutrition(r, opts) {
  opts = opts || {};
  if (!r) return { total: blankNutTotal(), rows: [] };
  // 缩放倍率：优先用 opts.factor（营养测算的「基准食材实际用量」推算），
  // 否则沿用旧逻辑 baseFactor * servings（兼容其它调用方）。
  const factor = (opts.factor != null) ? opts.factor : (scaleFactorOf(r) * (opts.servings != null ? opts.servings : 1));
  const rows = [];
  let sum = blankNutTotal();
  let pending = [];
  let noFood = [];
  r.sections.ingredients.concat(r.sections.seasonings).forEach(b => {
    if (b.kind !== 'item' || !b.name) return;
    const food = findNutFood(b.name);
    // 仅「单位 g / ml 且填了数值」的用料自动折算；个 / 勺 / 适量等按用户要求必须手动填，不自动折算
    let grams = nutIsAccurate(b) ? unitToGrams(scaleAmt(b.amount, factor), b.unit) : null;
    if (grams == null) {
      // 适量 / 未知单位：仅当「有营养数据」时才允许手动填克数补算；否则归入未填写（待下拉框填写）
      const ov = opts.gramsOverride && opts.gramsOverride[b.name];
      if (food && ov != null && !isNaN(ov) && ov > 0) grams = +ov * factor; // 手动填的也是原始用量，跟随整道菜倍率等比缩放
      else { pending.push(b.name); return; }
    }
    if (!food) { noFood.push(b.name); return; } // 已折算出克数，但营养库查不到
    const k = grams / 100;
    const row = {
      name: b.name,
      amount: scaleAmt(b.amount, factor), unit: b.unit, grams: Math.round(grams),
      kcal: +(food.kcal * k).toFixed(1),
      protein: +(food.protein * k).toFixed(1),
      fat: +(food.fat * k).toFixed(1),
      carb: +(food.carb * k).toFixed(1),
      sugar: food.sugar != null && food.sugar !== '' ? +(food.sugar * k).toFixed(1) : 0,
      sodium: food.sodium != null && food.sodium !== '' ? +(food.sodium * k).toFixed(1) : 0,
      fiber: food.fiber != null && food.fiber !== '' ? +(food.fiber * k).toFixed(1) : 0,
      matched: !!food,
    };
    rows.push(row);
    sum.kcal += row.kcal; sum.protein += row.protein; sum.fat += row.fat; sum.carb += row.carb;
    sum.sugar += row.sugar; sum.sodium += row.sodium; sum.fiber += row.fiber;
  });
  return {
    total: {
      kcal: Math.round(sum.kcal),
      protein: +sum.protein.toFixed(1),
      fat: +sum.fat.toFixed(1),
      carb: +sum.carb.toFixed(1),
      sugar: +sum.sugar.toFixed(1),
      sodium: +sum.sodium.toFixed(1),
      fiber: +sum.fiber.toFixed(1),
    },
    rows, pending: [...new Set(pending)], noFood: [...new Set(noFood)],
  };
}
function blankNutTotal() { return { kcal: 0, protein: 0, fat: 0, carb: 0, sugar: 0, sodium: 0, fiber: 0 }; }

/* 营养模块总入口：子视图 calc / lib */
function renderNutrition() {
  const tab = state.nutView || 'calc';
  const tabs = `
    <div class="nut-tabs">
      <button class="nut-tab ${tab === 'calc' ? 'active' : ''}" data-action="nut-tab" data-v="calc">🍽️ 菜谱测算</button>
      <button class="nut-tab ${tab === 'lib' ? 'active' : ''}" data-action="nut-tab" data-v="lib">📗 食物营养库</button>
    </div>`;
  setChrome('营养热量', '');
  $('content').innerHTML = tabs + (tab === 'calc' ? renderNutCalc() : renderNutLib());
}
function fmtTime(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* 日期字符串 YYYY-MM-DD（默认今天），用于热量记录按日归档 */
function todayStr(d) {
  d = d || new Date();
  const p = n => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---- 子视图一：菜谱营养测算（多选共同计算 + 分量调整 + 记录） ---- */
/* 缩放控件（替代份数）：支持「基准食材」与「基准份量」二选一 */
function nutScaleControlHTML(r) {
  const rid = r.id;
  const sc = state.nutScale[rid] || {};
  const mode = sc.mode === 'portion' ? 'portion' : 'ingredient';
  const toggle = `
    <div class="nut-scale-mode">
      <button class="nut-scale-mode-btn ${mode === 'ingredient' ? 'on' : ''}" data-action="nut-scale-mode" data-id="${escAttr(rid)}" data-mode="ingredient">基准食材</button>
      <button class="nut-scale-mode-btn ${mode === 'portion' ? 'on' : ''}" data-action="nut-scale-mode" data-id="${escAttr(rid)}" data-mode="portion">基准份量</button>
    </div>`;
  if (mode === 'ingredient') {
    const opts = nutBaseOptions(r);
    if (!opts.length) return toggle + `<div class="nut-scale nut-scale-hint">该菜谱还没有记录准确用量（克 / 毫升）的食材，无法按基准食材缩放；可改用「基准份量」，或先在菜谱里给食材填克 / 毫升。</div>`;
    const baseId = (sc.base && opts.some(o => o.id === sc.base)) ? sc.base : opts[0].id;
    const base = opts.find(o => o.id === baseId);
    const baseG = unitToGrams(base.amount, base.unit);
    const amount = sc.amount != null ? sc.amount : null;
    const unit = (sc.unit) ? sc.unit : (base.unit === 'ml' ? 'ml' : 'g');
    const factor = nutScaleFactorOf(r);
    const optHTML = opts.map(o => `<option value="${escAttr(o.id)}" ${o.id === baseId ? 'selected' : ''}>${escHtml(o.name)} ${o.amount}${escHtml(o.unit || '')}</option>`).join('');
    const ctrl = `
      <div class="nut-scale">
        <span class="nut-scale-label">基准食材</span>
        <select class="nut-scale-base" data-action="nut-scale-base" data-id="${escAttr(rid)}">${optHTML}</select>
        <span class="nut-scale-eq">实际</span>
        <input class="nut-scale-amt" type="number" step="any" min="0" data-action="nut-scale-amt" data-id="${escAttr(rid)}" value="${amount != null ? amount : ''}" placeholder="${baseG != null ? baseG : ''}"/>
        <select class="nut-scale-unit" data-action="nut-scale-unit" data-id="${escAttr(rid)}">
          <option value="g" ${unit === 'g' ? 'selected' : ''}>g</option>
          <option value="ml" ${unit === 'ml' ? 'selected' : ''}>ml</option>
        </select>
        ${factor !== 1 ? `<span class="nut-scale-eq">整道菜按 ${factor.toFixed(2)}× 缩放</span>` : `<span class="nut-scale-eq dim">改「实际」用量即等比缩放其它用料</span>`}
      </div>`;
    return toggle + ctrl;
  }
  // 基准份量模式：总重量（所有可折算克重的食材/调味料之和）× 实际克重 → 按 实际/总重量 比例缩放热量
  const total = nutTotalWeight(r);
  const actual = sc.actual != null ? sc.actual : null;
  const factor = nutScaleFactorOf(r);
  const ctrl = `
    <div class="nut-scale">
      <span class="nut-scale-label">基准份量</span>
      <span class="nut-scale-eq">总重量</span>
      <input class="nut-scale-total" type="number" readonly value="${total ? Math.round(total) : ''}" placeholder="0"/>
      <span class="nut-scale-eq">g</span>
      <span class="nut-scale-eq">实际</span>
      <input class="nut-scale-actual" type="number" step="any" min="0" data-action="nut-scale-actual" data-id="${escAttr(rid)}" value="${actual != null ? actual : ''}" placeholder="可输入克重"/>
      <span class="nut-scale-eq">g</span>
      ${total <= 0 ? `<span class="nut-scale-eq dim">请先给食材 / 调味料填克或毫升</span>` : (factor !== 1 ? `<span class="nut-scale-eq">整道菜按 ${factor.toFixed(2)}× 缩放</span>` : `<span class="nut-scale-eq dim">改「实际」克重即按比例缩放热量</span>`)}
    </div>`;
  return toggle + ctrl;
}

/* 未记录准确用量的食材：勾选菜谱后「全部自动显示」为填写行（单位默认 g，可切 ml；留空不计入） */
function nutManualControlHTML(r) {
  const all = nutImpreciseOptions(r);
  if (!all.length) return '';
  const rows = all.map(b => {
    const e = state.nutManual[r.id + '::' + b.name] || { amt: null, unit: 'g' };
    return `
      <div class="nut-imp-row">
        <span class="nut-imp-name">${escHtml(b.name)}</span>
        <input class="nut-imp-amt" type="number" step="any" min="0" placeholder="用量" value="${e.amt != null ? e.amt : ''}" data-action="nut-imp-amt" data-rid="${escAttr(r.id)}" data-name="${escAttr(b.name)}"/>
        <select class="nut-imp-unit" data-action="nut-imp-unit" data-rid="${escAttr(r.id)}" data-name="${escAttr(b.name)}">
          <option value="g" ${e.unit !== 'ml' ? 'selected' : ''}>g</option>
          <option value="ml" ${e.unit === 'ml' ? 'selected' : ''}>ml</option>
        </select>
      </div>`;
  }).join('');
  return `
    <div class="nut-imp">
      <div class="nut-imp-title">未记录准确用量的食材（逐项填写用量，留空不计入；单位默认 g）</div>
      <div class="nut-imp-rows">${rows}</div>
    </div>`;
}

/* 可视化结果区：默认显示“当前勾选”；点击右侧日历的“当日合计热量”或某条记录，可切换为对应热量构成 */
function nutResultHTML() {
  // 数据源优先级：单条记录 > 当日合计 > 当前勾选
  let mode = state.nutRecView ? 'rec' : (state.nutCalDayFocus && state.nutCalSel ? 'day' : 'sel');
  let total = null, rows = [];
  if (mode === 'rec') {
    const rec = state.nutRecords.find(x => x.id === state.nutRecView);
    if (!rec) mode = 'sel';
    else {
      total = rec.total;
      rows = (rec.rows || []).map(r => {
        const food = findNutFood(r.name);
        const k = (r.grams || 0) / 100;
        return {
          name: r.name,
          grams: r.grams || 0,
          kcal: r.kcal || 0,
          protein: food ? (food.protein || 0) * k : 0,
          fat: food ? (food.fat || 0) * k : 0,
          carb: food ? (food.carb || 0) * k : 0,
        };
      });
    }
  }
  if (mode === 'day') {
    const recs = state.nutRecords.filter(r => r.date === state.nutCalSel);
    total = blankNutTotal();
    recs.forEach(r => ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] += (r.total[k] || 0)));
    ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] = Math.round(total[k] * 10) / 10);
    // 按食材聚合当日所有记录的来源，使 Top3 来源在「当日合计」视图也有意义
    const byIng = {};
    recs.forEach(r => (r.rows || []).forEach(row => {
      const food = findNutFood(row.name);
      const k = (row.grams || 0) / 100;
      const key = norm(row.name);
      if (!byIng[key]) byIng[key] = { name: row.name, grams: 0, kcal: 0, protein: 0, fat: 0, carb: 0 };
      const a = byIng[key];
      a.grams += row.grams || 0;
      a.kcal += row.kcal || 0;
      a.protein += food ? (food.protein || 0) * k : 0;
      a.fat += food ? (food.fat || 0) * k : 0;
      a.carb += food ? (food.carb || 0) * k : 0;
    }));
    rows = Object.values(byIng);
  }
  let pending = '';
  if (mode === 'sel') {
    const selected = state.nutSelRecipes.map(id => getRecipe(id)).filter(Boolean);
    if (!selected.length) return `<div class="nut-empty"><div class="ico">🍳</div><p>勾选上方菜谱，自动按用量实时汇总热量与营养。</p></div>`;
    const rowsByName = {};
    total = blankNutTotal();
    let noFoodAll = [], pendingAll = [];
    selected.forEach(r => {
      const res = computeRecipeNutrition(r, { factor: nutScaleFactorOf(r), gramsOverride: nutManualMap(r) });
      res.rows.forEach(row => {
        const k = norm(row.name);
        if (!rowsByName[k]) rowsByName[k] = { name: row.name, grams: 0, kcal: 0, protein: 0, fat: 0, carb: 0, sugar: 0, sodium: 0, fiber: 0 };
        const a = rowsByName[k];
        a.grams += row.grams; a.kcal += row.kcal; a.protein += row.protein; a.fat += row.fat;
        a.carb += row.carb; a.sugar += row.sugar; a.sodium += row.sodium; a.fiber += row.fiber;
      });
      ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] += res.total[k]);
      res.noFood.forEach(n => noFoodAll.push(n));
      res.pending.forEach(n => pendingAll.push(n));
    });
    ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] = Math.round(total[k] * 10) / 10);
    rows = Object.values(rowsByName);
    nutAgg = { rows, total };
    nutNoFoodList = [...new Set(noFoodAll)];
    pending = pendingAll.length ? `
    <div class="nut-pending">
      ℹ️ 以下用量未填、暂未计入：${[...new Set(pendingAll)].map(n => escHtml(n)).join('、')}
    </div>` : '';
  }
  const pct = (v, tot) => tot > 0 ? Math.round(v / tot * 100) : 0;
  const eP = total.protein * 4, eF = total.fat * 9, eC = total.carb * 4;
  const eTot = eP + eF + eC || 1;
  const ring = `
    <div class="nut-ring">
      <svg viewBox="0 0 120 120" width="150" height="150">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#f0e6fa" stroke-width="14"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--brand)" stroke-width="14"
          stroke-dasharray="${(eP / eTot) * 326.7} 326.7" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="#ff9ec4" stroke-width="14"
          stroke-dasharray="${(eF / eTot) * 326.7} 326.7" stroke-dashoffset="${-(eP / eTot) * 326.7}" transform="rotate(-90 60 60)"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="#ffd27d" stroke-width="14"
          stroke-dasharray="${(eC / eTot) * 326.7} 326.7" stroke-dashoffset="${-((eP + eF) / eTot) * 326.7}" transform="rotate(-90 60 60)"/>
        <text x="60" y="54" text-anchor="middle" class="nut-ring-num">${total.kcal}</text>
        <text x="60" y="74" text-anchor="middle" class="nut-ring-unit">千卡 / 合计</text>
      </svg>
    </div>`;
  let macros = `
    <div class="nut-macros">
      <div class="macro p clickable" data-action="nut-macro" data-el="protein"><div class="macro-v">${total.protein}g</div><div class="macro-l">蛋白质 ${pct(eP, eTot)}%</div></div>
      <div class="macro f clickable" data-action="nut-macro" data-el="fat"><div class="macro-v">${total.fat}g</div><div class="macro-l">脂肪 ${pct(eF, eTot)}%</div></div>
      <div class="macro c clickable" data-action="nut-macro" data-el="carb"><div class="macro-v">${total.carb}g</div><div class="macro-l">碳水 ${pct(eC, eTot)}%</div></div>
    </div>
    <div class="nut-extra">
      <span class="ne sugar">糖 ${total.sugar}g</span>
      <span class="ne sodium">盐 ${total.sodium}mg</span>
      <span class="ne fiber">膳食纤维 ${total.fiber}g</span>
    </div>`;
  const top3For = (el, title) => {
    const list = rows.length ? rows.slice().sort((a, b) => (b[el] || 0) - (a[el] || 0)).slice(0, 3).map((r, i) => `
      <div class="nut-top-row">
        <span class="nut-top-rank">${i + 1}</span>
        <span class="nut-top-name">${escHtml(r.name)}</span>
        <span class="nut-top-val">${Math.round(r[el] * 10) / 10} g</span>
        <span class="nut-top-kcal">${Math.round(r.kcal)} kcal</span>
      </div>`).join('') : '<p class="dim" style="font-size:12px;margin:2px 0">暂无数据</p>';
    return `<div class="macro-top3" data-el="${el}" hidden>
      <div class="macro-top3-head">${title} · 来源最高的 3 种食材</div>
      <div class="nut-top-list">${list}</div>
    </div>`;
  };
  macros += `
    <div class="macro-top3-wrap">
      ${top3For('protein', '蛋白质')}
      ${top3For('fat', '脂肪')}
      ${top3For('carb', '碳水')}
    </div>
    <div class="macro-hint">${mode === 'sel' ? '点击三大营养素，下方展开贡献最高的 3 种食材' : '点击三大营养素，下方展开来源最高的 3 种食材'}</div>`;
  return ring + macros + pending;
}

/* 仅刷新营养结果区（保持选购行的输入框聚焦，不整页重渲染） */
function refreshNutResult() {
  const el = document.getElementById('nutResult');
  if (!el) { rerenderNut(); return; }
  el.innerHTML = nutResultHTML();
  const b = document.getElementById('nutMissingBanner');
  if (b) { b.innerHTML = nutMissingBannerHTML(); b.hidden = !nutNoFoodList.length; }
}

/* 点击宏量元素：在对应元素下方内联展开/收起「来源最高的 3 种食材」（不弹窗） */
function toggleNutMacro(el) {
  const panel = document.querySelector(`.macro-top3[data-el="${el}"]`);
  if (!panel) return;
  const card = document.querySelector(`.macro[data-el="${el}"]`);
  const willOpen = panel.hasAttribute('hidden');
  // 同一时间只展开一个，先收起其它
  document.querySelectorAll('.macro-top3.open').forEach(p => { p.setAttribute('hidden', ''); p.classList.remove('open'); });
  document.querySelectorAll('.macro.open').forEach(m => m.classList.remove('open'));
  if (willOpen) {
    panel.removeAttribute('hidden');
    panel.classList.add('open');
    if (card) card.classList.add('open');
  }
}

function renderNutCalc() {
  nutNoFoodList = [];   // 先清空，勾选测算后由 nutResultHTML 重新填充
  const recipes = state.recipes;
  if (!recipes.length) {
    return `<div class="nut-calc"><div class="nut-empty"><div class="ico">🔥</div><p>还没有菜谱，先去「菜谱库」添加几道菜，再来测算热量吧。</p></div></div>`;
  }
  const selList = nutSelListHTML();

  const selected = state.nutSelRecipes.map(id => getRecipe(id)).filter(Boolean);
  const hasSel = selected.length > 0;

  const recListOpen = state.nutRecListOpen || !!state.nutRecView; // 正在查看某条时强制展开，便于看到内联明细
  const recList = state.nutRecords.length ? `
    <div class="nut-rec-section ${recListOpen ? 'open' : ''}">
      <h3 class="nut-sub nut-rec-toggle" data-action="nut-rec-list-toggle">热量记录（${state.nutRecords.length}）<span class="nut-rec-chevron">▾</span></h3>
      ${recListOpen ? `<div class="nut-rec-list">
        ${state.nutRecords.slice().reverse().map(rec => `
          <div class="nut-rec ${state.nutRecView === rec.id ? 'on' : ''}" data-action="nut-rec-view" data-id="${escAttr(rec.id)}">
            <div class="nut-rec-main">
              <span class="nut-rec-k">${rec.total.kcal} 千卡</span>
              <span class="nut-rec-t">${fmtTime(rec.createdAt)}</span>
            </div>
            <div class="nut-rec-sub">${nutRecSub(rec)}</div>
            ${state.nutRecView === rec.id
              ? nutRecDetailHTML(rec)
              : `<div class="nut-rec-acts">
                   ${rec.custom ? '' : `<button class="tiny" data-action="nut-rec-apply" data-id="${escAttr(rec.id)}">套用此记录</button>`}
                   <button class="tiny danger" data-action="nut-rec-del" data-id="${escAttr(rec.id)}">删除</button>
                 </div>`}
          </div>`).join('')}
      </div>` : ''}
    </div>` : '';

  return `
    <div class="nut-calc">
      <div class="mod-searchbar">
        <span class="search-ico">🔍</span>
        <input id="nutCalcSearch" class="search-box" placeholder="搜索菜谱（名称 / 食材 / 标签）" value="${escAttr(state.nutCalcSearch || '')}" data-action="nut-calc-search"/>
      </div>
      <div class="nut-select-head">
        <h3 class="nut-sub" style="margin:0">选择菜谱（可多选共同计算）</h3>
        <div class="nut-select-acts">
          <button class="tiny" data-action="nut-all">全选</button>
          <button class="tiny" data-action="nut-reset">↻ 重置</button>
          <button class="btn sm primary" data-action="nut-record" ${hasSel ? '' : 'disabled'}>📝 生成记录</button>
        </div>
      </div>
      <div class="nut-sel-list">${selList}</div>
      <div class="nut-calc-top">
        <div class="nut-calc-visual">
          <div class="nut-cal-legend">🔥 热量构成</div>
          ${state.nutRecView || (state.nutCalDayFocus && state.nutCalSel) ? `
          <div class="nut-viz-focus">正在查看：${escHtml(state.nutRecView ? '该条记录' : state.nutCalSel)} <button class="tiny" data-action="nut-viz-reset">← 返回当前勾选</button></div>` : ''}
          <div id="nutResult">${(hasSel || state.nutRecView || (state.nutCalDayFocus && state.nutCalSel)) ? nutResultHTML() : `<div class="nut-empty"><div class="ico">🍳</div><p>勾选上方菜谱，自动按用量实时汇总热量与营养。</p></div>`}</div>
        </div>
        <div class="nut-calc-cal">
          ${nutMonthCalendarHTML()}
        </div>
      </div>
      <div id="nutMissingBanner" class="nut-missing-banner"${(hasSel && nutNoFoodList.length) ? '' : ' hidden'}>${nutMissingBannerHTML()}</div>
      ${recList}
    </div>`;
}

/* 缺营养数据提示区：展示查不到营养数据、无法计算热量的食材（置于「热量记录」上方；未选菜谱或无缺数据食材时由外层 hidden 隐藏） */
function nutMissingBannerHTML() {
  if (!nutNoFoodList.length) return '';
  return `
      <div class="nmb-head">⚠️ 以下食材缺少营养数据，无法计算热量（未计入统计）</div>
      <div class="nmb-tip">提示：可点「＋补录」添加到食物营养库，补齐后下次测算即可计入。</div>
      <div class="nmb-list">
        ${nutNoFoodList.map(n => `<span class="nmb-item"><span class="nmb-name">${escHtml(n)}</span><button class="tiny" data-action="nut-add-food" data-name="${escAttr(n)}">＋补录</button></span>`).join('')}
      </div>`;
}

/* ---- 当月热量日历（嵌入「菜谱测算」顶部右栏；有记录的日期用🍓标记，点日期看当日记录） ---- */

/* 菜谱勾选列表 HTML（营养测算用）；受 nutCalcSearch 过滤（仅本模块搜索） */
function nutSelListHTML() {
  const q = (state.nutCalcSearch || '').trim();
  const recipes = q ? state.recipes.filter(r => recipeMatches(r, q)) : state.recipes;
  if (!recipes.length) {
    return `<div class="nut-sel-empty dim">${state.recipes.length ? '没有匹配的菜谱' : '还没有菜谱，先去「菜谱库」添加'}</div>`;
  }
  return recipes.map(r => {
    const on = state.nutSelRecipes.includes(r.id);
    const cover = r.cover ? `style="background-image:url('${r.cover}')"` : '';
    const ctrl = on ? (nutScaleControlHTML(r) + nutManualControlHTML(r)) : '';
    return `
      <div class="nut-sel ${on ? 'on' : ''}">
        <label class="nut-sel-label">
          <input type="checkbox" ${on ? 'checked' : ''} data-action="nut-toggle" data-id="${escAttr(r.id)}"/>
          <span class="nut-sel-cover ${r.cover ? '' : 'no-img'}" ${cover}>${r.cover ? '' : '🍲'}</span>
          <span class="nut-sel-name">${escHtml(r.name || '未命名菜谱')}</span>
        </label>
        ${ctrl}
      </div>`;
  }).join('');
}

/* 记录详情 HTML（营养测算与营养日历共用） */
function nutRecDetailHTML(rec) {
  const sub = rec.custom ? '自定义记录（手动添加）'
    : '含菜谱：' + (rec.recipes || []).map(x => escHtml(x.name) + (x.scale ? (x.scale.mode === 'portion' ? `（基准份量 ${x.scale.actual != null ? x.scale.actual : ''}g）` : `（基准 ${x.scale.amount}${x.scale.unit}）`) : (x.servings != null ? `（${x.servings}份）` : ''))).join('、');
  return `
    <div class="nut-rec-detail">
      <div class="nut-rec-detail-head">
        <div><b>热量记录</b> · ${fmtTime(rec.createdAt)}</div>
        <button class="tiny" data-action="nut-rec-close">收起</button>
      </div>
      <div class="nut-rec-kcal">${rec.total.kcal} 千卡</div>
      <div class="nut-extra">
        <span class="ne sugar">糖 ${rec.total.sugar}g</span>
        <span class="ne sodium">盐 ${rec.total.sodium}mg</span>
        <span class="ne fiber">膳食纤维 ${rec.total.fiber}g</span>
      </div>
      <div class="nut-rec-rows">${rec.rows.map(x => `<div class="nut-rec-row">${escHtml(x.name)} ≈ ${Math.round(x.grams)}g · ${Math.round(x.kcal)}kcal</div>`).join('')}</div>
      <div class="nut-rec-recipes">${sub}</div>
      <div class="nut-rec-acts">
        ${rec.custom ? '' : `<button class="tiny" data-action="nut-rec-apply" data-id="${escAttr(rec.id)}">套用此记录</button>`}
        <button class="tiny danger" data-action="nut-rec-del" data-id="${escAttr(rec.id)}">删除</button>
      </div>
    </div>`;
}
/* 记录副标题（菜谱名 / 自定义记录 / 破折号） */
function nutRecSub(rec) {
  if (rec.recipes && rec.recipes.length) return rec.recipes.map(x => escHtml(x.name)).join('、');
  if (rec.custom) return '自定义记录';
  return '—';
}

/* 生成一条热量记录（含按日归档的 date 字段）；无勾选返回 null */
function genNutRecord() {
  const selected = state.nutSelRecipes.map(id => getRecipe(id)).filter(Boolean);
  if (!selected.length) return null;
  const rowsByName = {}; let total = blankNutTotal();
  selected.forEach(r => {
    const res = computeRecipeNutrition(r, { factor: nutScaleFactorOf(r), gramsOverride: nutManualMap(r) });
    res.rows.forEach(row => {
      const k = norm(row.name);
      if (!rowsByName[k]) rowsByName[k] = { name: row.name, grams: 0, kcal: 0, protein: 0, fat: 0, carb: 0, sugar: 0, sodium: 0, fiber: 0 };
      const a = rowsByName[k];
      a.grams += row.grams; a.kcal += row.kcal; a.protein += row.protein; a.fat += row.fat;
      a.carb += row.carb; a.sugar += row.sugar; a.sodium += row.sodium; a.fiber += row.fiber;
    });
    ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] += res.total[k]);
  });
  ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(k => total[k] = Math.round(total[k] * 10) / 10);
  return {
    id: uid(), createdAt: Date.now(), date: (state.nutCalSel || todayStr()),
    recipes: selected.map(r => ({ id: r.id, name: r.name, scale: state.nutScale[r.id] || null, manual: nutManualForRecord(r) })),
    total, rows: Object.values(rowsByName).map(x => ({ name: x.name, grams: Math.round(x.grams), kcal: Math.round(x.kcal) })),
  };
}

/* 套用一条记录：还原其菜谱勾选、基准缩放与手动用量 */
function applyNutRecord(id) {
  const rec = state.nutRecords.find(x => x.id === id);
  if (!rec) return;
  state.nutSelRecipes = rec.recipes.map(x => x.id);
  state.nutScale = {}; state.nutManual = {};
  rec.recipes.forEach(x => {
    if (x.scale) state.nutScale[x.id] = x.scale;
    if (x.manual) Object.keys(x.manual).forEach(n => { state.nutManual[x.id + '::' + n] = x.manual[n]; });
  });
}

/* 删除一条记录（同步清掉打开中的详情） */
function deleteNutRecord(id) {
  state.nutRecords = state.nutRecords.filter(x => x.id !== id);
  if (state.nutRecView === id) state.nutRecView = null;
  save();
}

/* ---- 自定义热量记录：点日期 → 手动加食材，联想食物营养库；库里没有需先补录 ---- */
let nutCustomDraft = null;   // { date, items:[{ name, grams, kcal, _sug }] }
let nutCustomReturn = false; // 补录后是否返回自定义记录弹窗

function openNutCustomModal(date) {
  nutCustomDraft = { date, items: [{ name: '', grams: '', kcal: '', _sug: [] }] };
  renderNutCustomModal();
}
function renderNutCustomModal() {
  const d = nutCustomDraft; if (!d) return;
  const rows = d.items.map((it, i) => {
    const food = findNutFood(it.name);
    const matched = !!food;
    const sug = it._sug || [];
    const kcalDisp = (it.kcal != null && it.kcal !== '') ? it.kcal
      : (matched && it.grams && !isNaN(it.grams) ? Math.round(food.kcal * it.grams / 100 * 10) / 10 : '');
    return `
      <div class="cc-row" data-i="${i}">
        <div class="cc-name-wrap">
          <input class="cc-name finput" data-action="cc-name" data-i="${i}" value="${escAttr(it.name)}" placeholder="食材名（可联想）"/>
          <div class="cc-sug" data-i="${i}" ${sug.length ? '' : 'hidden'}>
            ${sug.map(s => `<button type="button" class="cc-sug-item" data-action="cc-pick" data-i="${i}" data-name="${escAttr(s.name)}">${escHtml(s.name)} <span class="cc-sug-k">${s.kcal}kcal/100g</span></button>`).join('')}
          </div>
        </div>
        <input class="cc-grams finput" type="number" step="any" data-action="cc-grams" data-i="${i}" value="${escAttr(it.grams)}" placeholder="克数"/>
        <input class="cc-kcal finput" type="number" step="any" data-action="cc-kcal" data-i="${i}" value="${escAttr(kcalDisp)}" placeholder="千卡"/>
        ${matched ? '<span class="cc-ok" title="已在营养库">✓库</span>' : `<button type="button" class="tiny warn" data-action="cc-fillfood" data-i="${i}">补录</button>`}
        <button type="button" class="tiny danger" data-action="cc-del" data-i="${i}">×</button>
      </div>`;
  }).join('');
  let total = 0;
  d.items.forEach(it => { const k = parseFloat(it.kcal); if (!isNaN(k)) total += k; });
  total = Math.round(total * 10) / 10;
  const panel = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel nut-custom-modal">
        <div class="modal-title">添加自定义热量记录 · ${escHtml(d.date)}</div>
        <div class="cc-head"><span>食材</span><span>重量(g)</span><span>热量(kcal)</span><span></span></div>
        <div class="cc-rows">${rows}</div>
        <button type="button" class="btn sm" data-action="cc-add">＋ 添加食材</button>
        <div class="cc-total">合计：<b>${total}</b> 千卡</div>
        <div class="cc-tip">食材需先在「食物营养库」有数据；库里没有的请点「补录」加入后再记录（热量按 重量 × 库里热量 ÷ 100 自动算，也可手动改）。</div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn sm" data-action="modal-close">取消</button>
          <button type="button" class="btn sm primary" data-action="cc-save">保存记录</button>
        </div>
      </div>
    </div>`;
  openModal(panel);
}
function updateCcTotal() {
  if (!nutCustomDraft) return;
  let total = 0;
  nutCustomDraft.items.forEach(it => { const k = parseFloat(it.kcal); if (!isNaN(k)) total += k; });
  const el = document.querySelector('.cc-total b');
  if (el) el.textContent = Math.round(total * 10) / 10;
}
function saveNutCustomRecord() {
  if (!nutCustomDraft) return;
  const rows = [];
  let total = blankNutTotal();
  for (const it of nutCustomDraft.items) {
    const name = (it.name || '').trim();
    if (!name) { toast('有食材名称为空'); return; }
    const food = findNutFood(name);
    if (!food) { toast(`「${name}」不在营养库，请先点「补录」`); return; }
    const grams = parseFloat(it.grams);
    if (isNaN(grams) || grams <= 0) { toast(`「${name}」请填写重量(克)`); return; }
    let kcal = parseFloat(it.kcal);
    if (isNaN(kcal) || kcal <= 0) kcal = Math.round(food.kcal * grams / 100 * 10) / 10;
    const k = grams / 100;
    rows.push({ name, grams: Math.round(grams), kcal: Math.round(kcal * 10) / 10 });
    total.kcal += rows[rows.length - 1].kcal;
    total.protein += (food.protein || 0) * k;
    total.fat += (food.fat || 0) * k;
    total.carb += (food.carb || 0) * k;
    total.sugar += (food.sugar || 0) * k;
    total.sodium += (food.sodium || 0) * k;
    total.fiber += (food.fiber || 0) * k;
  }
  ['kcal', 'protein', 'fat', 'carb', 'sugar', 'sodium', 'fiber'].forEach(key => total[key] = Math.round(total[key] * 10) / 10);
  const rec = { id: uid(), createdAt: Date.now(), date: nutCustomDraft.date, custom: true, recipes: [], rows, total };
  state.nutRecords.push(rec);
  state.nutRecView = rec.id;
  save();
  nutCustomDraft = null;
  closeModal();
  rerenderNut();
  toast('已添加记录');
}

/* 营养相关视图统一重渲染（含嵌入的当月热量日历） */
function rerenderNut() {
  renderNutrition();
}

function nutMonthCalendarHTML() {
  if (!state.nutCal) state.nutCal = { y: new Date().getFullYear(), m: new Date().getMonth() };
  const { y, m } = state.nutCal;
  const startW = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const recDates = {};
  state.nutRecords.forEach(r => { if (r.date) recDates[r.date] = (recDates[r.date] || 0) + 1; });
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pendingDate = state.nutCalSel || todayStr;
  let cells = '';
  for (let i = 0; i < startW; i++) cells += `<div class="nut-cal-cell empty"><span class="nut-cal-num">~</span></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cnt = recDates[ds] || 0;
    const sel = state.nutCalSel === ds ? ' sel' : '';
    const todayCls = ds === todayStr ? ' today' : '';
    let cls = 'nut-cal-cell';
    if (cnt) cls += ' has-rec';
    else if (ds === pendingDate && state.nutSelRecipes && state.nutSelRecipes.length) cls += ' pending';
    cls += sel + todayCls;
    cells += `<div class="${cls}" data-action="nut-cal-day" data-date="${ds}">
      <span class="nut-cal-num">${d}</span></div>`;
  }
  const monthLabel = `${y}年${m + 1}月`;
  const dayRecords = state.nutCalSel
    ? state.nutRecords.filter(r => r.date === state.nutCalSel).sort((a, b) => b.createdAt - a.createdAt)
    : [];
  let dayKcal = 0, dayP = 0, dayF = 0, dayC = 0;
  dayRecords.forEach(r => {
    dayKcal += r.total.kcal || 0;
    dayP += r.total.protein || 0;
    dayF += r.total.fat || 0;
    dayC += r.total.carb || 0;
  });
  const r1 = v => Math.round(v * 10) / 10;
  const dayTotalHTML = dayRecords.length ? `
    <div class="nut-cal-daytotal clickable" data-action="nut-cal-daytotal">
      <span class="nut-cal-daytotal-k">${Math.round(dayKcal)} 千卡</span>
      <span class="nut-cal-daytotal-sub">当日合计热量 · 点击查看营养三元素 ▾</span>
    </div>
    <div class="nut-cal-daymacros" ${state.nutCalDayMacros ? '' : 'hidden'}>
      <div class="macro p"><div class="macro-v">${r1(dayP)}g</div><div class="macro-l">蛋白质</div></div>
      <div class="macro f"><div class="macro-v">${r1(dayF)}g</div><div class="macro-l">脂肪</div></div>
      <div class="macro c"><div class="macro-v">${r1(dayC)}g</div><div class="macro-l">碳水</div></div>
    </div>` : '';
  const dayList = state.nutCalSel ? `
    <div class="nut-cal-daylist">
      <div class="nut-cal-dayhead">
        <h4 class="nut-cal-daytitle">${state.nutCalSel} 的热量记录（${dayRecords.length}）</h4>
        <button class="btn sm primary" data-action="nut-cal-add-custom">＋ 添加自定义记录</button>
      </div>
      ${dayTotalHTML}
      ${dayRecords.length ? `<div class="nut-rec-list">${dayRecords.map(rec => `
        <div class="nut-rec ${state.nutRecView === rec.id ? 'on' : ''}" data-action="nut-rec-view" data-id="${escAttr(rec.id)}">
          <div class="nut-rec-main">
            <span class="nut-rec-k">${rec.total.kcal} 千卡</span>
            <span class="nut-rec-t">${fmtTime(rec.createdAt)}</span>
          </div>
          <div class="nut-rec-sub">${nutRecSub(rec)}</div>
          ${state.nutRecView === rec.id ? nutRecDetailHTML(rec) : ''}
        </div>`).join('')}</div>` : '<p class="dim">这一天还没有热量记录。</p>'}
    </div>` : `<p class="nut-cal-hint dim">点击带 🍓 的日期，查看当日的记录。</p>`;
  return `
    <div class="nut-cal-card">
      <div class="nut-cal-legend">📅 本月热量日历</div>
      <div class="nut-cal-head">
        <button class="tiny" data-action="nut-cal-prev">◀</button>
        <span class="nut-cal-title">${monthLabel}</span>
        <button class="tiny" data-action="nut-cal-next">▶</button>
      </div>
      <div class="nut-cal-body">
        ${['日', '一', '二', '三', '四', '五', '六'].map(w => `<span class="nut-cal-wd">${w}</span>`).join('')}
        ${cells}
      </div>
      ${dayList}
    </div>`;
}

/* ---- 子视图二：食物营养库 ---- */
function renderNutLib() {
  const q = (state.nutSearch || '').trim().toLowerCase();
  const list = state.nutfoods
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  const rows = list.map(f => `
    <div class="nut-food" data-action="nut-edit-food" data-id="${escAttr(f.id)}">
      <div class="nut-food-name">${escHtml(f.name)}</div>
      <div class="nut-food-kcal">${f.kcal} <small>kcal/100g</small></div>
      <div class="nut-food-macros">
        <span class="macro-t p">蛋白 ${f.protein}g</span>
        <span class="macro-t f">脂肪 ${f.fat}g</span>
        <span class="macro-t c">碳水 ${f.carb}g</span>
        ${f.sugar != null && f.sugar !== '' ? `<span class="macro-t s">糖 ${f.sugar}g</span>` : ''}
        ${f.sodium != null && f.sodium !== '' ? `<span class="macro-t s">盐 ${f.sodium}mg</span>` : ''}
        ${f.fiber != null && f.fiber !== '' ? `<span class="macro-t s">纤维 ${f.fiber}g</span>` : ''}
      </div>
    </div>`).join('') || '<p class="dim">没有匹配的食物</p>';
  return `
    <div class="nut-lib">
      <div class="nut-searchbar">
        <span class="search-ico">🔍</span>
        <input id="nutSearch" class="search-box" placeholder="搜索食物（如 鸡胸肉，输入即筛选）" value="${escAttr(state.nutSearch || '')}" data-action="nut-search"/>
        <button class="btn sm" data-action="nut-import">⬆ 批量导入</button>
        <button class="btn sm primary" data-action="nut-edit-food" data-id="">＋ 新增</button>
      </div>
      <div class="nut-food-list">${rows}</div>
      <p class="dim nut-tip">点任意一条可修改 / 删除；没找到的用「＋ 新增」补上；也可以用「批量导入」一次上传多行热量表（同名食材自动覆盖）。</p>
    </div>`;
}

/* 营养库批量导入弹窗：支持粘贴文本或上传文件，同名食材覆盖旧数据 */
function openNutImportModal() {
  const panel = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel nut-food-modal">
        <div class="modal-title">批量导入热量表</div>
        <p class="modal-hint">每行一种食物，用逗号分隔：<br><b>名称,热量,蛋白质,脂肪,碳水,糖,盐,纤维</b><br>例：<code>鸡胸肉,133,19.4,5,2.5</code>（糖/盐/纤维可省略）。同名食材会自动覆盖旧数据。</p>
        <textarea id="nutImportText" class="batch-input" placeholder="鸡胸肉,133,19.4,5,2.5&#10;西兰花,34,4.1,0.6,4.3"></textarea>
        <div class="import-file-row">
          <input type="file" id="nutImportFile" accept=".txt,.csv" />
        </div>
        <div id="nutImportMsg" class="import-msg"></div>
        <div class="modal-actions">
          <span class="spacer"></span>
          <button class="btn sm" data-action="modal-close">取消</button>
          <button class="btn sm primary" data-action="nut-import-do">导入</button>
        </div>
      </div>
    </div>`;
  openModal(panel);
  const fileEl = document.getElementById('nutImportFile');
  fileEl.addEventListener('change', () => {
    const file = fileEl.files && fileEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const ta = document.getElementById('nutImportText'); if (ta) ta.value = String(reader.result || ''); };
    reader.readAsText(file);
  });
}
function nutImportParse(text) {
  const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const out = []; const errs = [];
  lines.forEach((ln, i) => {
    const parts = ln.split(/[,，\t]/).map(s => s.trim());
    const name = parts[0];
    if (!name) { errs.push('第' + (i + 1) + '行缺少名称'); return; }
    const num = j => (parts[j] === undefined || parts[j] === '' ? '' : (isNaN(parseFloat(parts[j])) ? '' : parseFloat(parts[j])));
    out.push({ name, kcal: num(1), protein: num(2), fat: num(3), carb: num(4), sugar: num(5), sodium: num(6), fiber: num(7), per: 100 });
  });
  return { out, errs };
}
function upsertNutFood(f) {
  const exist = findNutFood(f.name);
  if (exist) Object.assign(exist, f);
  else state.nutfoods.push(Object.assign(blankNutFood(), f));
}
function nutImportApply(text) {
  const { out, errs } = nutImportParse(text);
  if (!out.length) { return { added: 0, covered: 0, errs: errs.length ? errs : ['没有可导入的数据'] }; }
  let added = 0, covered = 0;
  out.forEach(f => {
    const exist = findNutFood(f.name);
    if (exist) covered++; else added++;
    upsertNutFood(f);
  });
  return { added, covered, errs };
}

/* 营养库编辑弹窗（name 预填，用于从未匹配食材一键补录） */
function openNutFoodModal(id, name) {
  const f = id ? state.nutfoods.find(x => x.id === id) : null;
  const v = f || blankNutFood();
  if (name) v.name = name;
  const val = (k) => escAttr(v[k] != null && v[k] !== '' ? v[k] : '');
  const panel = `
    <div class="modal-mask" data-action="modal-close">
      <div class="modal-panel nut-food-modal">
        <div class="modal-title">${f ? '编辑食物营养' : '新增食物营养'}</div>
        <div class="field-row">
          <label class="field"><span class="field-label">食物名称</span>
            <input id="nfName" class="finput" value="${val('name')}" placeholder="如 鸡胸肉"/></label>
        </div>
        <div class="field-grid">
          <label class="field"><span class="field-label">热量 (kcal/100g)</span>
            <input id="nfKcal" class="finput" type="number" step="any" value="${val('kcal')}"/></label>
          <label class="field"><span class="field-label">蛋白质 (g)</span>
            <input id="nfProtein" class="finput" type="number" step="any" value="${val('protein')}"/></label>
          <label class="field"><span class="field-label">脂肪 (g)</span>
            <input id="nfFat" class="finput" type="number" step="any" value="${val('fat')}"/></label>
          <label class="field"><span class="field-label">碳水 (g)</span>
            <input id="nfCarb" class="finput" type="number" step="any" value="${val('carb')}"/></label>
          <label class="field"><span class="field-label">糖 (g)</span>
            <input id="nfSugar" class="finput" type="number" step="any" value="${val('sugar')}"/></label>
          <label class="field"><span class="field-label">盐/钠 (mg)</span>
            <input id="nfSodium" class="finput" type="number" step="any" value="${val('sodium')}"/></label>
          <label class="field"><span class="field-label">膳食纤维 (g)</span>
            <input id="nfFiber" class="finput" type="number" step="any" value="${val('fiber')}"/></label>
        </div>
        <div class="modal-actions">
          ${f ? `<button class="btn sm danger" data-action="nut-del-food" data-id="${escAttr(f.id)}">删除</button>` : ''}
          <span class="spacer"></span>
          <button class="btn sm" data-action="modal-close">取消</button>
          <button class="btn sm primary" data-action="nut-save-food" data-id="${escAttr(f ? f.id : '')}">保存</button>
        </div>
      </div>
    </div>`;
  openModal(panel);
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
    case 'lib-search-clear': state.search = ''; renderLibrary(); break;
    case 'fav-search-clear': state.favSearch = ''; renderFavorites(); break;
    case 'pur-search-clear': state.purchaseSearch = ''; renderPurchase(); break;
    case 'filter-search-clear': state.filterSearch = ''; renderFilter(); break;
    case 'open-editor-new': openEditor(null); break;
    case 'goto-filter': gotoFilterCat(t.dataset.cat); break;
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
        const src = await compressImage(files[0], 1280, 0.72);
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
        for (const f of files) imgs.push(await compressImage(f, 1280, 0.72));
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
    /* 备菜组图片：点区域选图，裁剪后写入该组 */
    case 'prep-group-img': {
      const gid = t.dataset.gid;
      const files = await pickFiles({ multiple: false });
      if (files && files[0]) {
        const src = await compressImage(files[0], 1280, 0.72);
        openCrop(null, null, src, (out) => { const g = findPrepGroup(gid); if (g) { g.img = out; refreshSection('prep'); } });
      }
      break;
    }
    case 'prep-group-img-del': { const g = findPrepGroup(t.dataset.gid); if (g) { g.img = null; refreshSection('prep'); } break; }
    case 'enlarge-prep-img': { const r = getRecipe(state.viewId); const g = r && r.sections.prep.find(x => x.id === t.dataset.gid); if (g && g.img) showImage(g.img); break; }

    /* ===== 营养热量模块 ===== */
    case 'nut-tab': state.nutView = t.dataset.v; rerenderNut(); break;
    case 'nut-toggle': {
      const id = t.dataset.id;
      if (state.nutSelRecipes.includes(id)) state.nutSelRecipes = state.nutSelRecipes.filter(x => x !== id);
      else state.nutSelRecipes.push(id);
      rerenderNut(); break;
    }
    /* 基准缩放模式切换：基准食材 / 基准份量 二选一 */
    case 'nut-scale-mode': {
      const rid = t.dataset.id, mode = t.dataset.mode;
      if (!state.nutScale[rid]) state.nutScale[rid] = { base: null, amount: null, unit: 'g' };
      state.nutScale[rid].mode = mode;
      rerenderNut(); break;
    }
    case 'nut-all': state.nutSelRecipes = state.recipes.map(r => r.id); rerenderNut(); break;
    case 'nut-reset':
      state.nutSelRecipes = []; state.nutScale = {}; state.nutManual = {}; state.nutRecView = null;
      rerenderNut(); break;
    case 'nut-macro': toggleNutMacro(t.dataset.el); break;
    case 'nut-cal-prev': {
      if (!state.nutCal) state.nutCal = { y: new Date().getFullYear(), m: new Date().getMonth() };
      let { y, m } = state.nutCal; m--; if (m < 0) { m = 11; y--; }
      state.nutCal = { y, m }; rerenderNut(); break;
    }
    case 'nut-cal-next': {
      if (!state.nutCal) state.nutCal = { y: new Date().getFullYear(), m: new Date().getMonth() };
      let { y, m } = state.nutCal; m++; if (m > 11) { m = 0; y++; }
      state.nutCal = { y, m }; rerenderNut(); break;
    }
    case 'nut-cal-day': {
      state.nutCalSel = t.dataset.date;
      state.nutRecView = null;
      rerenderNut(); break;
    }
    case 'nut-cal-daytotal': state.nutCalDayFocus = true; state.nutCalDayMacros = !state.nutCalDayMacros; state.nutRecView = null; rerenderNut(); break;
    case 'nut-record': {
      const rec = genNutRecord();
      if (!rec) { toast('请先勾选至少一道菜谱'); break; }
      state.nutRecords.unshift(rec);
      save();
      state.nutRecView = rec.id;
      state.nutCalSel = rec.date;
      rerenderNut();
      toast('已生成热量记录');
      break;
    }
    case 'nut-rec-view': state.nutRecView = (state.nutRecView === t.dataset.id) ? null : t.dataset.id; state.nutCalDayFocus = false; rerenderNut(); break;
    case 'nut-rec-list-toggle': state.nutRecListOpen = !state.nutRecListOpen; rerenderNut(); break;
    case 'nut-viz-reset': state.nutRecView = null; state.nutCalDayFocus = false; rerenderNut(); break;
    case 'nut-rec-close': state.nutRecView = null; rerenderNut(); break;
    case 'nut-rec-del':
      state.nutRecords = state.nutRecords.filter(x => x.id !== t.dataset.id);
      if (state.nutRecView === t.dataset.id) state.nutRecView = null;
      save(); rerenderNut(); break;
    case 'nut-rec-apply': {
      applyNutRecord(t.dataset.id);
      rerenderNut(); toast('已套用该记录的菜谱与用量'); break;
    }
    case 'nut-import': openNutImportModal(); break;
    case 'nut-import-do': {
      const ta = document.getElementById('nutImportText');
      const text = ta ? ta.value : '';
      const res = nutImportApply(text);
      if (res.errs && res.errs.length) {
        const msg = document.getElementById('nutImportMsg');
        if (msg) msg.innerHTML = '<span class="import-err">' + res.errs.join('<br>') + '</span>';
        if (!res.added && !res.covered) break;
      }
      save();
      closeModal();
      renderNutrition();
      toast('导入完成：新增 ' + res.added + ' 条，覆盖 ' + res.covered + ' 条');
      break;
    }
    case 'nut-add-food': openNutFoodModal(null, t.dataset.name); break;
    case 'nut-edit-food': openNutFoodModal(t.dataset.id || null); break;
    case 'nut-save-food': {
      const id = t.dataset.id;
      const name = document.getElementById('nfName').value.trim();
      const getN = (k) => { const v = document.getElementById(k).value; return v === '' ? '' : parseFloat(v); };
      if (!name) { toast('请填写食物名称'); break; }
      const data = { name, kcal: getN('nfKcal'), protein: getN('nfProtein'), fat: getN('nfFat'), carb: getN('nfCarb'), sugar: getN('nfSugar'), sodium: getN('nfSodium'), fiber: getN('nfFiber'), per: 100 };
      if (id) {
        const f = state.nutfoods.find(x => x.id === id);
        if (f) Object.assign(f, data);
      } else {
        state.nutfoods.push(Object.assign(blankNutFood(), data));
      }
      save();
      if (nutCustomReturn) { nutCustomReturn = false; renderNutCustomModal(); toast('已补录，可继续添加记录'); break; }
      closeModal();
      renderNutrition();
      toast('已保存');
      break;
    }
    case 'nut-del-food': {
      const id = t.dataset.id;
      state.nutfoods = state.nutfoods.filter(x => x.id !== id);
      save();
      closeModal();
      renderNutrition();
      toast('已删除');
      break;
    }
    case 'nut-cal-add-custom': {
      if (!state.nutCalSel) { toast('请先点选一个日期'); break; }
      openNutCustomModal(state.nutCalSel); break;
    }
    case 'cc-pick': {
      const i = +t.dataset.i; if (!nutCustomDraft) break;
      nutCustomDraft.items[i].name = t.dataset.name;
      nutCustomDraft.items[i]._sug = [];
      renderNutCustomModal(); break;
    }
    case 'cc-add': if (nutCustomDraft) { nutCustomDraft.items.push({ name: '', grams: '', kcal: '', _sug: [] }); renderNutCustomModal(); } break;
    case 'cc-del': if (nutCustomDraft) { nutCustomDraft.items.splice(+t.dataset.i, 1); if (!nutCustomDraft.items.length) nutCustomDraft.items.push({ name: '', grams: '', kcal: '', _sug: [] }); renderNutCustomModal(); } break;
    case 'cc-fillfood': {
      if (!nutCustomDraft) break;
      const i = +t.dataset.i;
      const nm = (nutCustomDraft.items[i].name || '').trim();
      nutCustomReturn = true; openNutFoodModal(null, nm); break;
    }
    case 'cc-save': saveNutCustomRecord(); break;
  }
}

/* ---------------- 事件：输入 ---------------- */
/* 搜索输入：每次按键不再整页重渲染导致输入框失焦；中文输入法组合期间不重渲染，避免打不了中文 */
const SEARCH_ACTIONS = ['lib-search', 'nut-calc-search', 'fav-search', 'pur-search', 'filter-search', 'nut-search'];
function refocusSearch(action) {
  const inp = document.querySelector(`[data-action="${action}"]`);
  if (inp) { inp.focus(); const n = inp.value.length; try { inp.setSelectionRange(n, n); } catch (_) {} }
}
function setSearchValue(action, value) {
  switch (action) {
    case 'lib-search': state.search = value; break;
    case 'nut-calc-search': state.nutCalcSearch = value; break;
    case 'fav-search': state.favSearch = value; break;
    case 'pur-search': state.purchaseSearch = value; break;
    case 'filter-search': state.filterSearch = value; break;
    case 'nut-search': state.nutSearch = value; break;
  }
}
/* 实时筛选：输入即筛选（防抖 120ms），清空输入框即恢复显示全部；中文输入法组合期间不重渲染，避免打断中文 */
function applySearch(action, value) {
  setSearchValue(action, value);
  switch (action) {
    case 'lib-search': renderLibrary(); break;
    case 'nut-calc-search': rerenderNut(); break;
    case 'fav-search': renderFavorites(); break;
    case 'pur-search': renderPurchase(); break;
    case 'filter-search': renderFilter(); break;
    case 'nut-search': rerenderNut(); break;
  }
  refocusSearch(action);
}
const searchTimers = {};
function scheduleSearch(action, value) {
  clearTimeout(searchTimers[action]);
  searchTimers[action] = setTimeout(() => { applySearch(action, value); }, 120);
}
function handleKeydown(e) {
  const t = e.target;
  if (t.dataset.action && SEARCH_ACTIONS.includes(t.dataset.action) && e.key === 'Enter') {
    if (e.isComposing) return;            // 中文输入法组合中回车用于确认候选词，不触发筛选
    e.preventDefault();
    clearTimeout(searchTimers[t.dataset.action]);
    applySearch(t.dataset.action, t.value);
  }
}
function handleInput(e) {
  const t = e.target;
  if (t.dataset.action && SEARCH_ACTIONS.includes(t.dataset.action)) {
    setSearchValue(t.dataset.action, t.value);
    if (e.isComposing) return;            // 中文组合期间不重渲染，避免打断输入法
    scheduleSearch(t.dataset.action, t.value); // 输入即实时筛选；清空则显示全部
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
  if (t.dataset.action === 'nut-imp-amt') {
    const rid = t.dataset.rid, name = t.dataset.name;
    const v = t.value === '' ? null : parseFloat(t.value);
    const key = rid + '::' + name;
    if (!state.nutManual[key]) state.nutManual[key] = { amt: null, unit: 'g' };
    state.nutManual[key].amt = (v == null || isNaN(v)) ? null : v;
    refreshNutResult(); return;   // 只刷新结果区，保持输入框聚焦
  }
  if (t.dataset.action === 'nut-scale-amt') {
    const rid = t.dataset.id;
    const v = t.value === '' ? null : parseFloat(t.value);
    if (!state.nutScale[rid]) state.nutScale[rid] = { base: null, amount: null, unit: 'g' };
    state.nutScale[rid].amount = (v == null || isNaN(v)) ? null : v;
    if (!state.nutScale[rid].base) {
      const r = getRecipe(rid); const opts = r ? nutBaseOptions(r) : [];
      if (opts.length) state.nutScale[rid].base = opts[0].id;
    }
    refreshNutResult(); return;   // 只刷新结果区，保持输入框聚焦
  }
  if (t.dataset.action === 'nut-scale-actual') {
    const rid = t.dataset.id;
    const v = t.value === '' ? null : parseFloat(t.value);
    if (!state.nutScale[rid]) state.nutScale[rid] = { base: null, amount: null, unit: 'g' };
    state.nutScale[rid].actual = (v == null || isNaN(v)) ? null : v;
    refreshNutResult(); return;   // 只刷新结果区，保持输入框聚焦
  }
  if (t.dataset.action === 'p-portion-amt') {
    const r = getRecipe(t.dataset.id); if (!r) return;
    const v = t.value === '' ? null : parseFloat(t.value);
    r.scaleAmount = (v == null || isNaN(v)) ? null : v;
    save(); return;
  }
  if (t.dataset.action === 'cc-name') {
    const i = +t.dataset.i; if (!nutCustomDraft || !nutCustomDraft.items[i]) return;
    const v = t.value;
    nutCustomDraft.items[i].name = v;
    const q = v.trim().toLowerCase();
    const sug = state.nutfoods.filter(f => !q || f.name.toLowerCase().includes(q)).slice(0, 8);
    nutCustomDraft.items[i]._sug = sug;
    const box = document.querySelector(`.cc-sug[data-i="${i}"]`);
    if (box) {
      box.innerHTML = sug.map(s => `<button type="button" class="cc-sug-item" data-action="cc-pick" data-i="${i}" data-name="${escAttr(s.name)}">${escHtml(s.name)} <span class="cc-sug-k">${s.kcal}kcal/100g</span></button>`).join('');
      if (sug.length) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
    }
    return;
  }
  if (t.dataset.action === 'cc-grams') {
    const i = +t.dataset.i; if (!nutCustomDraft || !nutCustomDraft.items[i]) return;
    nutCustomDraft.items[i].grams = t.value;
    const food = findNutFood(nutCustomDraft.items[i].name);
    if (food && t.value && !isNaN(t.value) && +t.value > 0) {
      const k = Math.round(food.kcal * t.value / 100 * 10) / 10;
      nutCustomDraft.items[i].kcal = k;
      const ki = document.querySelector(`.cc-kcal[data-i="${i}"]`); if (ki) ki.value = k;
    }
    updateCcTotal(); return;
  }
  if (t.dataset.action === 'cc-kcal') {
    const i = +t.dataset.i; if (!nutCustomDraft || !nutCustomDraft.items[i]) return;
    nutCustomDraft.items[i].kcal = t.value; updateCcTotal(); return;
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
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return; // 触摸设备（手机/平板）不支持原生拖拽且会干扰点击，排序改用 ↑↓ 按钮
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
  if (t.dataset.action === 'nut-scale-base') {
    const rid = t.dataset.id;
    const r = getRecipe(rid);
    const base = r && (r.sections.ingredients || []).concat(r.sections.seasonings || []).find(b => b.id === t.value && b.kind === 'item');
    if (!state.nutScale[rid]) state.nutScale[rid] = { base: null, amount: null, unit: 'g' };
    state.nutScale[rid].base = t.value;
    state.nutScale[rid].amount = null;   // 换基准后清空实际用量，等待重新填写
    state.nutScale[rid].unit = base ? (base.unit === 'ml' ? 'ml' : 'g') : 'g';
    rerenderNut(); return;
  }
  if (t.dataset.action === 'nut-scale-unit') {
    const rid = t.dataset.id;
    if (!state.nutScale[rid]) state.nutScale[rid] = { base: null, amount: null, unit: 'g' };
    state.nutScale[rid].unit = t.value;
    rerenderNut(); return;
  }
  if (t.dataset.action === 'nut-imp-unit') {
    const rid = t.dataset.rid, name = t.dataset.name;
    const key = rid + '::' + name;
    if (!state.nutManual[key]) state.nutManual[key] = { amt: null, unit: 'g' };
    state.nutManual[key].unit = t.value;
    rerenderNut(); return;
  }
}
function init() {
  load();
  ensureUnitList();
  renderNav();                                  // 渲染桌面侧边栏 + 手机抽屉导航（数据驱动，便于扩展）
  document.addEventListener('click', onChromeClick);   // 导航项 / 汉堡菜单 / 抽屉开关 / 悬浮新增
  // 监听绑定在 document 上，覆盖顶栏操作按钮与弹窗（均不在 #content 内）
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('keydown', handleKeydown);
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
