// Orca-Design · 9 类 Open Artifact 作品元数据、旧 .design/ 映射与共享规范

export const LEGACY_TO_TYPE = {
  'claude-slides': 'slides',
  'claude-design': 'design',
  'claude-design-system': 'design-system',
  'claude-dashboard': 'data',
  'claude-motion': 'motion',
};

export const TYPE_TO_LEGACY = Object.fromEntries(
  Object.entries(LEGACY_TO_TYPE).map(([k, v]) => [v, k])
);

export function normalizeTypeId(id) {
  if (typeof id !== 'string') return '';
  const clean = id.trim();
  return LEGACY_TO_TYPE[clean] || clean;
}

export const SKILLS = [
  {
    id: 'slides',
    legacyId: 'claude-slides',
    name: '幻灯片',
    nameEn: 'Slides',
    category: '演示',
    categoryEn: 'Presentations',
    plugin: 'open-artifact-slides',
    tint: '#e8703a',
    titlePath: ['project/deck.json', 'title'],
    marker: 'project/deck.json',
    detect: ['project/deck.json'],
    folder: ['project'],
    exports: ['PDF', 'PPTX', 'HTML', 'PNG'],
    uses: ['design-system'],
    blankCreatable: false,
    hasExampleScaffold: true,
    prompt: '帮我做一份幻灯片：\n风格：\n受众：\n时长：\n核心信息：\n数据或素材：\n页数偏好：\n语言：\n（风格槽为空必须先问用户再动手；无大纲时用叙事弧（钩子→定调→主体→转折→收束）先出一页式大纲再生成）（每个 section 需带 data-layout="S01封面|S02章节|S03要点|S04引文|S05数据" 标注，版式约束见插件 references/layouts.json；未登记版式视为不合格）',
    promptEn: 'Help me create a slide deck about: ',
    about: '做可以编辑的 16:9 / 4:3 幻灯片，支持演讲备注与导出 PDF、PPTX、HTML、PNG。',
    aboutEn: 'Editable slides for presenting or exporting to PDF, PPTX, HTML, or PNG.',
  },
  {
    id: 'design',
    legacyId: 'claude-design',
    name: '设计画布',
    nameEn: 'Design',
    category: '设计',
    categoryEn: 'Design',
    plugin: 'open-artifact-design',
    tint: '#7a5cf0',
    titlePath: ['project/canvas.json', 'title'],
    marker: 'project/canvas.json',
    detect: ['project/canvas.json'],
    folder: ['project'],
    exports: ['PNG', 'JPEG', 'PDF', 'HTML'],
    uses: ['design-system'],
    blankCreatable: true,
    hasExampleScaffold: true,
    prompt: '帮我设计画布与界面方案：',
    promptEn: 'Help me design screens or visual concepts on a canvas: ',
    about: '在一张无限画布上并排做几版设计稿与原型，每一版都能直接微调并导出。',
    aboutEn: 'Explore editable designs and prototypes side by side on a live canvas.',
  },
  {
    id: 'design-system',
    legacyId: 'claude-design-system',
    name: '设计系统',
    nameEn: 'Design System',
    category: '品牌规范',
    categoryEn: 'Design',
    plugin: 'open-artifact-design-system',
    tint: '#c79a1b',
    titlePath: ['project/design-system.json', 'title'],
    marker: 'project/design-system.json',
    detect: ['project/design-system.json'],
    folder: ['project'],
    exports: [],
    uses: [],
    blankCreatable: false,
    hasExampleScaffold: true,
    prompt: '帮我做一套设计系统，品牌是：',
    promptEn: 'Help me create a design system for the brand: ',
    about: '做一套可复用的设计系统：颜色、字体、组件、资产与品牌手册，供其他作品安装引用。',
    aboutEn: 'Build brand colors, typography, components, and guidelines reusable across artifacts.',
  },
  {
    id: 'whiteboard',
    legacyId: '',
    name: '白板',
    nameEn: 'Whiteboard',
    category: '协作',
    categoryEn: 'Collaboration',
    plugin: 'open-artifact-whiteboard',
    tint: '#2563eb',
    titlePath: ['db/board/meta.json', 'title'],
    marker: 'db/board/meta.json',
    detect: ['db/board/meta.json'],
    folder: ['db', '_blobs', 'src'],
    exports: ['PNG', 'ZIP'],
    uses: [],
    blankCreatable: true,
    hasExampleScaffold: false,
    prompt: '帮我在白板上整理思路或流程图，主题是：',
    promptEn: 'Help me create a whiteboard diagram or brainstorm about: ',
    about: '无限共享白板：便签、图形、连线、手绘墨迹与架构草图，支持导出 PNG。',
    aboutEn: 'A shared infinite whiteboard with sticky notes, shapes, arrows, and diagrams.',
  },
  {
    id: 'sheets',
    legacyId: '',
    name: '电子表格',
    nameEn: 'Sheets',
    category: '数据',
    categoryEn: 'Data',
    plugin: 'open-artifact-sheets',
    tint: '#16a34a',
    titlePath: ['sheet/sheet.json', 'title'],
    marker: 'sheet/sheet.json',
    detect: ['sheet/sheet.json'],
    folder: ['sheet'],
    exports: ['XLSX', 'CSV', 'ZIP'],
    uses: [],
    blankCreatable: true,
    hasExampleScaffold: false,
    prompt: '帮我制作一份电子表格（含公式与格式），内容是：',
    promptEn: 'Help me build a spreadsheet workbook with formulas for: ',
    about: '内置公式引擎的多表工作簿，支持筛选、图表及 XLSX / CSV 导入导出。',
    aboutEn: 'A spreadsheet with formula engine, multi-sheet tabs, and XLSX/CSV export.',
  },
  {
    id: 'data',
    legacyId: 'claude-dashboard',
    name: '数据看板',
    nameEn: 'Data',
    category: '数据',
    categoryEn: 'Data',
    plugin: 'open-artifact-data',
    tint: '#e5484d',
    titlePath: ['db/dash/meta.json', 'title'],
    marker: 'db/dash/meta.json',
    detect: ['db/dash/meta.json'],
    folder: ['db', '_blobs', 'src'],
    exports: ['PDF', 'HTML', 'JSON', 'ZIP'],
    uses: ['design-system'],
    blankCreatable: false,
    hasExampleScaffold: false,
    prompt: '帮我做一个数据看板与报表，数据是：',
    promptEn: 'Help me create a live data dashboard and report from: ',
    about: '用数据文件或查询做交互式看板：图表、指标卡和表格，支持导出 PDF / HTML / JSON。',
    aboutEn: 'Create live dashboards, charts, metrics, and tables from your data.',
  },
  {
    id: 'docs',
    legacyId: '',
    name: '协作文档',
    nameEn: 'Docs',
    category: '文档',
    categoryEn: 'Documents',
    plugin: 'open-artifact-docs',
    tint: '#0ea5e9',
    titlePath: ['doc/doc.json', 'name'],
    marker: 'doc/doc.json',
    detect: ['doc/doc.json'],
    folder: ['doc'],
    exports: ['MD', 'Word', 'PDF', 'HTML', 'ZIP'],
    uses: [],
    blankCreatable: true,
    hasExampleScaffold: false,
    prompt: '帮我撰写一份多标签协作文档，主题是：',
    promptEn: 'Help me write a living document with tabs about: ',
    about: '多标签富文本文档：支持批注建议与 Markdown、Word、PDF 导入导出。',
    aboutEn: 'A living document with tabs, inline suggestions, and Word/PDF/Markdown export.',
  },
  {
    id: 'motion',
    legacyId: 'claude-motion',
    name: '短动画',
    nameEn: 'Motion',
    category: '媒体',
    categoryEn: 'Media',
    plugin: 'open-artifact-motion',
    tint: '#1fa971',
    titlePath: ['db/film/meta.json', 'title'],
    marker: 'db/film/meta.json',
    detect: ['db/film/meta.json'],
    folder: ['db', '_blobs', 'src'],
    exports: ['MP4', 'GIF', 'HTML', 'ZIP'],
    uses: ['design-system'],
    blankCreatable: false,
    hasExampleScaffold: false,
    prompt: '帮我做一段短动画，内容是：',
    promptEn: 'Help me create a short animated motion piece about: ',
    about: '逐场景时间轴代码动画，支持配音字幕与导出 MP4、GIF、HTML。',
    aboutEn: 'Create short animated films and export as MP4, GIF, or standalone HTML.',
  },
  {
    id: 'page',
    legacyId: '',
    name: '自由页面',
    nameEn: 'Page',
    category: '页面',
    categoryEn: 'Pages',
    plugin: 'open-artifact-page',
    tint: '#d97706',
    titlePath: ['.artifact.json', 'title'],
    marker: 'index.html',
    detect: ['index.html'],
    folder: ['index.html', '.artifact.json'],
    exports: [],
    uses: [],
    blankCreatable: true,
    hasExampleScaffold: false,
    prompt: '帮我做一个单页交互网页（index.html），主题是：',
    promptEn: 'Help me build an interactive standalone HTML page about: ',
    about: '自由单页 HTML 作品（index.html + .artifact.json），支持独立预览与交互调试。',
    aboutEn: 'A standalone interactive HTML page artifact with live preview.',
  },
];

export const BUILTIN_TYPE_IDS = SKILLS.map((s) => s.id);

export const SKILL_BY_ID = {};
for (const s of SKILLS) {
  SKILL_BY_ID[s.id] = s;
  if (s.legacyId) SKILL_BY_ID[s.legacyId] = s;
}

export function resolveTypeMeta(id) {
  const norm = normalizeTypeId(id);
  return SKILLS.find((s) => s.id === norm) || null;
}

export const TITLES = Object.fromEntries(
  Object.entries(SKILL_BY_ID).map(([k, s]) => [k, s.titlePath])
);

export const TINTS = Object.fromEntries(
  Object.entries(SKILL_BY_ID).map(([k, s]) => [k, s.tint])
);

export const FOLDER = Object.fromEntries(
  Object.entries(SKILL_BY_ID).map(([k, s]) => [k, s.folder])
);

export const ROOT_MARKERS = Object.fromEntries(
  Object.entries(SKILL_BY_ID).map(([k, s]) => [k, s.detect])
);

export const PROMPTS = Object.fromEntries(
  Object.entries(SKILL_BY_ID).map(([k, s]) => [k, s.prompt])
);

export const RECIPES = [
  {
    id: 'ds-to-all',
    title: '设计系统 → 全家统一',
    desc: '先做一套设计系统，再用它的 token 做幻灯片',
    template: '帮我先在当前工作区建立一套设计系统（品牌、色板、字体、间距），完成后基于这套设计系统的 token 直接做一份幻灯片，两步连续完成，风格保持统一。品牌是：',
  },
  {
    id: 'canvas-to-motion',
    title: '画布多稿 → 动效演示',
    desc: '画布上探索几版设计，选优后做成动效',
    template: '帮我在画布上并排做 3 版设计方案探索，比较后选出最优一版，然后把选中的方案做成一段动效演示。主题是：',
  },
  {
    id: 'data-to-report',
    title: '数据 → 看板 → 汇报',
    desc: '先做数据看板，再产出汇报幻灯片',
    template: '帮我先做一个数据看板（指标、图表、布局），看板完成后基于看板内容做一份汇报幻灯片，要点直接取自看板数据。数据是：',
  },
  {
    id: 'explore-to-ds',
    title: '画布探索 → 沉淀设计系统',
    desc: '画布上试风格，定稿后沉淀成设计系统',
    template: '帮我在画布上探索一个产品的视觉方向（多稿），定稿后把确定的风格沉淀成一套可复用的设计系统。产品是：',
  },
];

export const EDITOR_FILES = [
  '.artifact-server.json',
  '.artifact-server.log',
  '.artifact.json',
  '.sharing.json',
  '.gitignore',
  '.DS_Store',
  'comments.json',
  'history',
  'exports',
];

export const NOT_CONTENT = new Set([...EDITOR_FILES, '.sessions.json', '.git', 'node_modules', '.orca', 'dist']);

const DESIGN_EXAMPLE = {
  dirName: 'design-demo',
  files: {
    'project/canvas.json': '__INDEX__',
    'project/Main.dc.html':
      '<!doctype html><html><head><meta charset="utf-8"><script src="./support.js"></script>'
      + '<style>body{margin:0;font-family:-apple-system,sans-serif}'
      + 'x-dc{display:block;width:880px;height:560px;background:#0ea5e9;color:#fff;'
      + 'display:flex;align-items:center;justify-content:center}h1{font-size:64px}</style></head>'
      + '<body><x-dc><h1>Hello Canvas</h1></x-dc>\n'
      + '<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":880,"height":560}}\'>'
      + 'class Component extends DCLogic {}</script>\n</body></html>',
  },
};

const SLIDES_EXAMPLE = {
  dirName: 'slides-demo',
  files: {
    'project/deck.json': '__INDEX__',
    'project/slides/cover.html':
      '<section style="background:#1e293b;color:#fff;display:flex;align-items:center;'
      + 'justify-content:center"><h1 style="font-size:96px;font-family:-apple-system,sans-serif">'
      + '示例演示</h1></section>',
  },
};

const DS_EXAMPLE = {
  dirName: 'design-system-demo',
  files: {
    'project/design-system.json': '__INDEX__',
    'project/README.md': '# 示例设计系统\n\n由 Orca-Design 创建的示例骨架。让工作区 agent 参考本目录继续完善。\n',
    'project/tokens.json': '{}',
  },
};

const PAGE_EXAMPLE = {
  dirName: 'page-demo',
  files: {
    '.artifact.json': JSON.stringify({ type: 'page', title: 'Blank Page' }, null, 2),
    'index.html':
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>New Page</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#0f172a}</style></head>'
      + '<body><main><h1>Hello Page</h1><p>Edit index.html to customize this page.</p></main></body></html>',
  },
};

export const EXAMPLE_TEMPLATES = {
  'design': DESIGN_EXAMPLE,
  'claude-design': DESIGN_EXAMPLE,
  'slides': SLIDES_EXAMPLE,
  'claude-slides': SLIDES_EXAMPLE,
  'design-system': DS_EXAMPLE,
  'claude-design-system': DS_EXAMPLE,
  'page': PAGE_EXAMPLE,
};

const DESIGN_IDX = {
  v: 3,
  launch: { view: 'canvas' },
  pages: [],
  boards: { 'Main.dc.html': { x: 0, y: 0, w: 880, h: 560, title: '欢迎' } },
  order: ['Main.dc.html'],
  notes: {},
  designSystems: [],
};

const SLIDES_IDX = {
  v: 4,
  lists: 'css',
  order: ['cover'],
  cover: 'cover',
  sections: {},
  faces: {},
  designSystems: [],
};

const DS_IDX = {
  v: 3,
  layout: 'files',
  namespace: 'ExampleDesignSystem',
  libraries: [],
  sections: {},
  groups: [],
  assetGroups: {},
  blobs: {},
  docs: { readme: 'project/README.md', sections: [] },
  lastChange: {},
};

export const EXAMPLE_INDEX = {
  'design': DESIGN_IDX,
  'claude-design': DESIGN_IDX,
  'slides': SLIDES_IDX,
  'claude-slides': SLIDES_IDX,
  'design-system': DS_IDX,
  'claude-design-system': DS_IDX,
};
