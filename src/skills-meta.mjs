// Prototype Studio · 技能元数据与共享规范
// 对齐 baoyu-design v2.12.0 及 dsh-claude-artifacts 规范

export const SKILLS = [
  {
    id: 'claude-slides',
    name: '幻灯片',
    nameEn: 'Slides',
    plugin: 'dsh-claude-slides',
    icon: '🖼️',
    port: 4710,
    tint: '#e8703a',
    titlePath: ['project/deck.json', 'title'],
    marker: 'project/deck.json',
    folder: ['project'],
    prompt: '帮我做一份幻灯片，主题是：（每个 section 需带 data-layout="S01封面|S02章节|S03要点|S04引文|S05数据" 标注，版式约束见插件 references/layouts.json；未登记版式视为不合格）',
    about: '做可以编辑的幻灯片，能直接演示，也能导出 PDF、HTML 或 PowerPoint。',
  },
  {
    id: 'claude-design',
    name: '设计',
    nameEn: 'Canvas',
    plugin: 'dsh-claude-design',
    icon: '🎨',
    port: 4720,
    tint: '#7a5cf0',
    titlePath: ['project/canvas.json', 'title'],
    marker: 'project/canvas.json',
    folder: ['project'],
    prompt: '帮我设计：',
    about: '在一张画布上并排做几版设计稿，每一版都能直接改。',
  },
  {
    id: 'claude-design-system',
    name: '设计系统',
    nameEn: 'Design System',
    plugin: 'dsh-claude-design-system',
    icon: '🧩',
    port: 4730,
    tint: '#c79a1b',
    titlePath: ['project/design-system.json', 'title'],
    marker: 'project/design-system.json',
    folder: ['project'],
    prompt: '帮我做一套设计系统，品牌是：',
    about: '做一套设计系统：颜色、字体、组件、素材，加一本品牌手册。',
  },
  {
    id: 'claude-dashboard',
    name: '看板',
    nameEn: 'Dashboard',
    plugin: 'dsh-claude-dashboard',
    icon: '📊',
    port: 4740,
    tint: '#e5484d',
    titlePath: ['db/dash/meta.json', 'title'],
    marker: 'db/dash/meta.json',
    folder: ['db', '_blobs', 'src'],
    prompt: '帮我做一个数据看板，数据是：',
    about: '用你的数据文件做看板：图表、数字和表格，数据变了就跟着更新。',
  },
  {
    id: 'claude-motion',
    name: '动画',
    nameEn: 'Motion',
    plugin: 'dsh-claude-motion',
    icon: '🎬',
    port: 4760,
    tint: '#1fa971',
    titlePath: ['db/film/meta.json', 'title'],
    marker: 'db/film/meta.json',
    folder: ['db', '_blobs', 'src'],
    prompt: '帮我做一段动画，内容是：',
    about: '做短动画，导出 MP4 或 GIF。',
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const TITLES = Object.fromEntries(SKILLS.map((s) => [s.id, s.titlePath]));

export const TINTS = Object.fromEntries(SKILLS.map((s) => [s.id, s.tint]));

export const FOLDER = Object.fromEntries(SKILLS.map((s) => [s.id, s.folder]));

export const ROOT_MARKERS = Object.fromEntries(SKILLS.map((s) => [s.id, [s.marker]]));

export const DEFAULT_PORTS = Object.fromEntries(SKILLS.map((s) => [s.id, s.port]));

export const PROMPTS = Object.fromEntries(SKILLS.map((s) => [s.id, s.prompt]));

export const EDITOR_FILES = [
  '.artifact-server.json',
  '.artifact-server.log',
  '.sharing.json',
  '.gitignore',
  '.DS_Store',
  'comments.json',
  'history',
  'exports',
];

export const NOT_CONTENT = new Set([...EDITOR_FILES, '.sessions.json', '.git', 'node_modules', '.orca', 'dist']);

// 静态脚手架示例
export const EXAMPLE_TEMPLATES = {
  'claude-design': {
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
  },
  'claude-slides': {
    dirName: 'slides-demo',
    files: {
      'project/deck.json': '__INDEX__',
      'project/slides/cover.html':
        '<section style="background:#1e293b;color:#fff;display:flex;align-items:center;'
        + 'justify-content:center"><h1 style="font-size:96px;font-family:-apple-system,sans-serif">'
        + '示例演示</h1></section>',
    },
  },
  'claude-design-system': {
    dirName: 'design-system-demo',
    files: {
      'project/design-system.json': '__INDEX__',
      'project/README.md': '# 示例设计系统\n\n由 Prototype Studio 创建的示例骨架。让工作区 agent 参考本目录继续完善。\n',
      'project/tokens.json': '{}',
    },
  },
};

export const EXAMPLE_INDEX = {
  'claude-design': {
    v: 3,
    launch: { view: 'canvas' },
    pages: [],
    boards: { 'Main.dc.html': { x: 0, y: 0, w: 880, h: 560, title: '欢迎' } },
    order: ['Main.dc.html'],
    notes: {},
    designSystems: [],
  },
  'claude-slides': {
    v: 4,
    lists: 'css',
    order: ['cover'],
    cover: 'cover',
    sections: {},
    faces: {},
    designSystems: [],
  },
  'claude-design-system': {
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
  },
};
