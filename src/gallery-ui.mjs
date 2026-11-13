// Lakala-Design-Plugin · 工作区画廊界面模块（双语目录、工作室布局样式与交互脚本）

const SKILL_EN_COPY = {
  'claude-slides': [
    'Editable slides for presenting or exporting to PDF, HTML, or PowerPoint.',
    'Help me create a slide deck about: ',
  ],
  'claude-design': [
    'Explore editable designs side by side on an infinite canvas.',
    'Help me design: ',
  ],
  'claude-design-system': [
    'Unify brand colors, typography, spacing tokens, live components, and guidelines.',
    'Help me create a design system for the brand: ',
  ],
  'claude-dashboard': [
    'Build live-updating charts, KPIs, and data tables from your files.',
    'Help me create a data dashboard from: ',
  ],
  'claude-motion': [
    'Craft expressive short motion pieces and export MP4 or GIF.',
    'Help me animate: ',
  ],
};

const RECIPE_EN_COPY = {
  'ds-to-all': ['Design system → Unified deck', 'Establish brand tokens first, then build a cohesive slide deck from them.'],
  'canvas-to-motion': ['Canvas concepts → Motion piece', 'Explore 3 directions on canvas, pick a winner, and animate it.'],
  'data-to-report': ['Data → Dashboard → Executive deck', 'Turn raw metrics into a dashboard, then summarize into presentation slides.'],
  'explore-to-ds': ['Canvas exploration → Design system', 'Iterate visual directions freely, then codify the final style into tokens.'],
};

export function createGalleryStrings(skills, recipes, examples) {
  const str = {
    zh: {
      works: '设计工作台',
      studioSubtitle: '以统一设计系统驱动画布探索、商业演示与数据视图',
      navOverview: '工作台总览',
      navDesignSystem: '设计系统',
      navWorks: '作品库',
      navExamples: '精选示例',
      navWorkflows: '协同工作流',
      railWorkspaceLabel: '当前焦点工作区',
      railNoWorkspace: '等待识别工作区',
      railSkillsLabel: '按工具筛选作品',
      allTypes: '全部',
      schemeToggle: '切换明暗外观',
      searchPlaceholder: '搜索作品名称、类型或目录 (/)',
      search: '搜索作品',
      clearSearch: '清除搜索',
      sortFilter: '排序和筛选',
      switchView: '切换视图',
      refresh: '刷新列表',
      new: '快速新建',
      newSubtitle: '选择创作工具，从内置规范模板或 Agent 提示词开始',
      recommendedFoundation: '推荐基石',
      examples: '预置精选示例',
      examplesSubtitle: '基于拉卡拉品牌语言打磨的 5 套完整可编辑成品，支持直接写入工作区或交由 Agent 延展',
      workflows: '跨技能 AI 工作流',
      workflowsSubtitle: '一键在当前工作区发起多步串联任务，让设计系统与下游产出保持一致',
      allWorks: '全部作品',
      scopeWorkspace: '当前工作区 ({count})',
      scopeAll: '全部历史 ({count})',
      emptyCompactText: '当前工作区尚无作品，可直接使用上方精选示例或从下方工具快速新建。',
      emptyShowOtherWs: '查看其他工作区作品 ({count})',
      currentWsBadge: '当前工作区',
      otherWsBadge: '历史工作区',
      back: '← 返回工作台',
      popOut: '浏览器打开 ↗',
      language: '切换语言',
      undo: '撤销',
      restored: '已恢复作品',
      restoreFailed: '恢复失败: ',
      listView: '切换到列表视图',
      gridView: '切换到网格视图',
      noMatches: '没有符合筛选条件的作品',
      noWorks: '当前工作区还没有作品',
      clearHint: '试试清除搜索关键词或重置筛选条件。',
      emptyHint: '推荐先从上方「拉卡拉 · 品牌设计系统」一键启用规范，或从下方精选示例直接创建首个可编辑项目。',
      clearFilters: '重置筛选',
      projectPreview: '作品预览',
      missing: '文件已不在',
      missingReasonDir: '原目录已移走或清理',
      missingReasonMarker: '缺少项目索引文件',
      missingBannerTitle: '有 {count} 条历史记录的原项目文件已不在原路径',
      missingBannerDesc: '这些记录来自已删除或移动的旧目录，已自动从主列表收起，清理记录不会删除任何现有文件。',
      missingShow: '查看明细',
      missingHide: '收起明细',
      missingClearAll: '一键清除全部 ({count})',
      missingClearedAll: '✓ 已清理 {count} 条失效历史记录',
      opening: '正在启动编辑器…',
      creating: '正在创建…',
      more: '更多操作',
      unpin: '取消固定',
      pin: '固定到顶部',
      cannotOpen: '无法打开：',
      unknownError: '未知错误',
      openFailed: '打开失败：',
      rename: '重命名',
      recreate: '做同款',
      useTemplate: '使用模板',
      copyLink: '复制编辑器链接',
      forget: '清除记录',
      delete: '删除',
      draftCopied: '提示词草稿已复制，请粘贴给 Agent：',
      remixFailed: '启动同款失败: ',
      forgotten: '已移除该条失效记录',
      forgetFailed: '清除失败: ',
      linkCopied: '编辑器链接已复制到剪贴板',
      linkFailed: '获取编辑器链接失败',
      renameTitle: '重命名作品',
      cancel: '取消',
      save: '保存',
      renameFailed: '重命名失败: ',
      deleteMove: '这会将该作品从列表移除，并把文件夹安全移入应用数据目录下的 baoyu-design/trash（可撤销）。',
      deleteKeep: '这会将它从作品列表移除。因目录内还包含其他工程文件，原文件夹保留在：',
      deleteFailed: '删除失败: ',
      copyPrompt: '复制 Agent 提示词',
      createBlank: '用内置模板直接创建',
      promptCopied: '✓ 提示词已复制到剪贴板，发送给 Agent 即可',
      copyFailed: '复制失败，请手动复制：',
      createFailed: '创建失败: ',
      sortOpened: '最近打开',
      sortUpdated: '最近修改',
      sortCreated: '创建时间',
      sortName: '名称排序',
      any: '不限',
      today: '今天',
      yesterday: '昨天',
      week: '最近 7 天',
      month: '最近 30 天',
      shared: '已局域网共享',
      private: '仅本地',
      sortBy: '排序方式',
      type: '技能类型',
      selectedSuffix: ' 项',
      openedAt: '打开时间',
      sharing: '共享状态',
      pinned: '仅看已固定',
      preview: '大图预览',
      exampleSkeleton: '此示例提供项目结构骨架，创建后可由 Agent 继续填充内容。',
      close: '关闭',
      exampleStarted: '✓ 已发起新对话并附带示例参考草稿',
      exampleCreatedToast: '✓ 已在工作区创建「{title}」',
      startFailed: '启动失败：',
      draftPrefix: '；草稿：',
      workflowFailed: '工作流启动失败: ',
      refreshed: '✓ 作品列表已同步',
      workspace: '工作区 · ',
      loadFailed: '列表加载失败：',
      justOpened: '刚刚打开',
      openedRelative: '{time}打开',
      relativeFallback: '{count} {unit}前',
      minute: '分钟',
      hour: '小时',
      day: '天',
      weekUnit: '周',
      monthUnit: '个月',
      year: '年',
      boards: '{count} 画板',
      pages: '{count} 页',
      scenes: '{count} 场景',
      components: '{count} 组件',
      sheets: '{count} 报表',
      dashboard: '看板',
      samplePresentation: '示例演示',
      renameDescription: '为「{title}」设置新的作品名称：',
      renamed: '已重命名为「{title}」',
      deleteTitle: '删除「{title}」？',
      deleted: '已移入回收站：「{title}」',
      removed: '已从列表移除「{title}」，原文件夹保留在原处。',
      createTitle: '新建{title}',
      allWorksCount: '作品库 ({count})',
      remixSent: '✓ 已在新对话发送同款创作草稿（{outcome}）',
      workflowSent: '✓ 已在新对话启动工作流（{outcome}）',
      languageButton: 'EN',
      previewTitle: '{title} · 预览',
      runWorkflow: '启动工作流 ↗',
      dsEyebrowDefault: 'DEFAULT DESIGN SYSTEM · 内置默认规范',
      dsEyebrowActive: 'WORKSPACE DESIGN SYSTEM · 当前工作区已启用',
      dsHeroTitle: '拉卡拉 · 品牌设计系统',
      dsHeroDesc: '提炼自 lakala.com 官方网站视觉体系：以明亮的品牌青 #00B9F1 传递连接感，深海蓝 #0B3875 承载商业信任，配合 #007FA8 无障碍交互色，一套语义 Token 贯通网页、移动端与演示提案。',
      dsActiveDesc: '当前工作区已配置统一设计系统「{title}」。所有新建画布、幻灯片与 Agent 创作均可直接沿用这套品牌 Token 与组件规范。',
      dsStatColors: '12 色彩语义',
      dsStatThemes: 'Light / Dark 双主题',
      dsStatType: '7 级字阶标尺',
      dsStatComps: '5 套实时组件',
      dsInitBtn: '启用至当前工作区',
      dsOpenBtn: '打开设计系统编辑器',
      dsInspectBtn: '规范与组件全景预览',
      dsAgentBtn: '让 Agent 按此规范创作',
      dsTabColors: '色彩语义 Token',
      dsTabType: '字体与间距尺度',
      dsTabComps: '核心组件实景',
      dsCopyHint: '点击任意色卡复制 CSS 变量与色值',
      dsTokenCopied: '✓ 已复制 {token} ({hex})',
      dsScaleSpacing: '8pt 间距节奏',
      dsScaleRadius: '圆角梯度',
      dsOpenAllComps: '全屏检视全部 5 套组件与品牌手册 ↗',
      dsModalSubtitle: '切换上方组件标签可实时检视 HTML 交互卡片，点击「启用至当前工作区」即可在编辑器中修改全部 Token 与文档。',
    },
    en: {
      works: 'Design Studio',
      studioSubtitle: 'One design system driving canvas explorations, decks, and live dashboards',
      navOverview: 'Overview',
      navDesignSystem: 'Design System',
      navWorks: 'Projects',
      navExamples: 'Curated Examples',
      navWorkflows: 'AI Workflows',
      railWorkspaceLabel: 'Focused Workspace',
      railNoWorkspace: 'Workspace pending',
      railSkillsLabel: 'Filter by Tool',
      allTypes: 'All',
      schemeToggle: 'Toggle appearance',
      searchPlaceholder: 'Search projects, skills, or folders (/)',
      search: 'Search projects',
      clearSearch: 'Clear search',
      sortFilter: 'Sort & filter',
      switchView: 'Switch view',
      refresh: 'Refresh list',
      new: 'Quick Create',
      newSubtitle: 'Pick a studio tool to scaffold from built-in templates or copy an agent prompt',
      recommendedFoundation: 'Foundation',
      examples: 'Curated Built-in Examples',
      examplesSubtitle: 'Five complete, editable projects crafted with the Lakala design language—instantiate locally or remix with your agent',
      workflows: 'Cross-Skill AI Workflows',
      workflowsSubtitle: 'Launch multi-step agent pipelines in your focused workspace while keeping visual tokens aligned',
      allWorks: 'Projects',
      scopeWorkspace: 'Workspace ({count})',
      scopeAll: 'All History ({count})',
      emptyCompactText: 'No projects in this workspace yet—instantiate a curated example above or create from a tool below.',
      emptyShowOtherWs: 'View other workspaces ({count})',
      currentWsBadge: 'Current workspace',
      otherWsBadge: 'Other workspace',
      back: '← Back to Studio',
      popOut: 'Open in browser ↗',
      language: 'Switch language',
      undo: 'Undo',
      restored: 'Project restored',
      restoreFailed: 'Restore failed: ',
      listView: 'Switch to list view',
      gridView: 'Switch to grid view',
      noMatches: 'No matching projects',
      noWorks: 'No projects in this workspace yet',
      clearHint: 'Try clearing your search query or resetting active filters.',
      emptyHint: 'Activate the built-in Lakala Design System above or instantiate one of the curated examples below to start editing.',
      clearFilters: 'Reset filters',
      projectPreview: 'Project preview',
      missing: 'Files missing',
      missingReasonDir: 'Folder moved or deleted',
      missingReasonMarker: 'Project index missing',
      missingBannerTitle: '{count} historical record(s) point to folders no longer at their original path',
      missingBannerDesc: 'Stale records are tucked away from your active grid. Clearing them only removes index entries and never touches existing files.',
      missingShow: 'Show details',
      missingHide: 'Hide details',
      missingClearAll: 'Clear all ({count})',
      missingClearedAll: '✓ Cleared {count} stale record(s)',
      opening: 'Launching editor…',
      creating: 'Creating…',
      more: 'More actions',
      unpin: 'Unpin',
      pin: 'Pin to top',
      cannotOpen: 'Cannot open: ',
      unknownError: 'Unknown error',
      openFailed: 'Open failed: ',
      rename: 'Rename',
      recreate: 'Remix',
      useTemplate: 'Use template',
      copyLink: 'Copy editor link',
      forget: 'Remove record',
      delete: 'Delete',
      draftCopied: 'Draft copied—paste it to your agent: ',
      remixFailed: 'Remix failed: ',
      forgotten: 'Stale record removed',
      forgetFailed: 'Could not remove record: ',
      linkCopied: 'Editor link copied to clipboard',
      linkFailed: 'Could not get editor link',
      renameTitle: 'Rename project',
      cancel: 'Cancel',
      save: 'Save',
      renameFailed: 'Rename failed: ',
      deleteMove: 'This removes the project and moves its folder to baoyu-design/trash (undoable).',
      deleteKeep: 'This removes the project from the list. Its folder contains other files and stays at: ',
      deleteFailed: 'Delete failed: ',
      copyPrompt: 'Copy agent prompt',
      createBlank: 'Create from built-in template',
      promptCopied: '✓ Prompt copied. Paste it to your agent.',
      copyFailed: 'Copy failed. Copy manually: ',
      createFailed: 'Create failed: ',
      sortOpened: 'Recently opened',
      sortUpdated: 'Recently modified',
      sortCreated: 'Creation time',
      sortName: 'Name',
      any: 'Any',
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'Last 7 days',
      month: 'Last 30 days',
      shared: 'Shared on LAN',
      private: 'Local only',
      sortBy: 'Sort by',
      type: 'Skill type',
      selectedSuffix: ' selected',
      openedAt: 'Opened',
      sharing: 'Sharing',
      pinned: 'Pinned only',
      preview: 'Preview',
      exampleSkeleton: 'This example provides a project scaffold. Remix it to have your agent populate content.',
      close: 'Close',
      exampleStarted: '✓ Started a new agent chat with the example brief',
      exampleCreatedToast: '✓ Created “{title}” in workspace',
      startFailed: 'Start failed: ',
      draftPrefix: '; draft: ',
      workflowFailed: 'Workflow failed: ',
      refreshed: '✓ Project list synced',
      workspace: 'Workspace · ',
      loadFailed: 'Load failed: ',
      justOpened: 'Opened just now',
      openedRelative: 'Opened {time}',
      relativeFallback: '{count} {unit} ago',
      minute: 'minutes',
      hour: 'hours',
      day: 'days',
      weekUnit: 'weeks',
      monthUnit: 'months',
      year: 'years',
      boards: '{count} artboards',
      pages: '{count} slides',
      scenes: '{count} scenes',
      components: '{count} components',
      sheets: '{count} sheets',
      dashboard: 'Dashboard',
      samplePresentation: 'Sample presentation',
      renameDescription: 'Set a new title for “{title}”:',
      renamed: 'Renamed to “{title}”',
      deleteTitle: 'Delete “{title}”?',
      deleted: 'Moved “{title}” to trash.',
      removed: 'Removed “{title}” from list. Folder kept in place.',
      createTitle: 'New {title}',
      allWorksCount: 'Projects ({count})',
      remixSent: '✓ Remix brief sent to new chat ({outcome})',
      workflowSent: '✓ Workflow started in new chat ({outcome})',
      languageButton: '中',
      previewTitle: '{title} · Preview',
      runWorkflow: 'Start workflow ↗',
      dsEyebrowDefault: 'DEFAULT DESIGN SYSTEM · BUILT-IN',
      dsEyebrowActive: 'WORKSPACE DESIGN SYSTEM · ACTIVE',
      dsHeroTitle: 'Lakala · Brand Design System',
      dsHeroDesc: 'Distilled from lakala.com: vibrant Brand Cyan #00B9F1 for connectivity, Deep Navy #0B3875 for trust, and accessible #007FA8 actions—one semantic token set powering web, mobile, and slide decks.',
      dsActiveDesc: 'Unified design system “{title}” is active in this workspace. Open the editor to refine tokens and components, or have your agent build on top of it.',
      dsStatColors: '12 Color Tokens',
      dsStatThemes: 'Light & Dark Themes',
      dsStatType: '7-Step Type Scale',
      dsStatComps: '5 Live Components',
      dsInitBtn: 'Initialize in Workspace',
      dsOpenBtn: 'Open System Editor',
      dsInspectBtn: 'Inspect Tokens & Components',
      dsAgentBtn: 'Build with Agent',
      dsTabColors: 'Color Tokens',
      dsTabType: 'Typography & Scale',
      dsTabComps: 'Live Components',
      dsCopyHint: 'Click any swatch to copy CSS variable & hex',
      dsTokenCopied: '✓ Copied {token} ({hex})',
      dsScaleSpacing: '8pt Spacing Rhythm',
      dsScaleRadius: 'Corner Radii',
      dsOpenAllComps: 'Inspect all 5 live component cards & brand book ↗',
      dsModalSubtitle: 'Switch tabs above to inspect live component cards, or initialize in your workspace to customize tokens.',
    },
  };

  for (const skill of skills) {
    for (const field of ['name', 'about', 'prompt']) str.zh[`skill.${skill.id}.${field}`] = skill[field];
    str.en[`skill.${skill.id}.name`] = skill.nameEn;
    const [about, prompt] = SKILL_EN_COPY[skill.id] || [skill.about, skill.prompt];
    str.en[`skill.${skill.id}.about`] = about;
    str.en[`skill.${skill.id}.prompt`] = prompt;
  }

  for (const recipe of recipes) {
    for (const field of ['title', 'desc']) str.zh[`recipe.${recipe.id}.${field}`] = recipe[field];
    const [title, desc] = RECIPE_EN_COPY[recipe.id] || [recipe.title, recipe.desc];
    str.en[`recipe.${recipe.id}.title`] = title;
    str.en[`recipe.${recipe.id}.desc`] = desc;
  }

  for (const example of examples) {
    str.zh[`example.${example.id}.title`] = example.title;
    str.zh[`example.${example.id}.desc`] = example.desc;
    str.zh[`example.${example.id}.points`] = example.points;
    str.en[`example.${example.id}.title`] = example.titleEn || example.title;
    str.en[`example.${example.id}.desc`] = example.descEn || example.desc;
    str.en[`example.${example.id}.points`] = example.pointsEn || example.points;
  }

  return str;
}

export const GALLERY_CSS = `
html[data-i18n-pending] body { visibility: hidden; }
:root {
  color-scheme: light dark;
  --lk-cyan: #00b9f1;
  --lk-deep: #0b3875;
  --lk-ink: #102b46;
  --lk-action: light-dark(#007fa8, #4fd1f5);
  --lk-pale: light-dark(#e6f7fd, rgba(0, 185, 241, 0.14));
  --dsw-alias-bg-base: light-dark(#f4f8fa, #0b131b);
  --studio-surface: light-dark(#ffffff, #121f2b);
  --studio-surface-2: light-dark(#eef4f8, #172836);
  --studio-rail: light-dark(#ebf2f6, #0e1822);
  --dsw-alias-bg-skeleton: light-dark(#e9f0f5, #192a38);
  --dsw-alias-border-l1: light-dark(#cfdde6, #284052);
  --dsw-alias-border-l2: light-dark(rgba(16, 43, 70, 0.09), rgba(224, 242, 254, 0.11));
  --dsw-alias-interactive-bg-hover: light-dark(rgba(16, 43, 70, 0.055), rgba(224, 242, 254, 0.07));
  --dsw-alias-label-primary: light-dark(#102b46, #eff6fa);
  --dsw-alias-label-secondary: light-dark(#486173, #a8c0cf);
  --dsw-alias-label-tertiary: light-dark(#647d8e, #7d98a9);
  --dsw-alias-label-caption: light-dark(#8ba0ae, #577182);
  --dsw-alias-state-business-primary: light-dark(#007fa8, #38c8f2);
  --dsw-alias-state-error-primary: light-dark(#c53042, #f87185);
  --dsw-focus-ring-color: light-dark(#007fa8, #38c8f2);
  --dsw-focus-ring-width: 2px;
  --studio-shadow-sm: light-dark(0 2px 8px rgba(16, 43, 70, 0.04), 0 2px 10px rgba(0, 0, 0, 0.28));
  --studio-shadow-md: light-dark(0 14px 36px -10px rgba(16, 43, 70, 0.12), 0 18px 42px -12px rgba(0, 0, 0, 0.5));
}
html[data-scheme=dark] { color-scheme: dark; }
html[data-scheme=light] { color-scheme: light; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  height: 100vh;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
button, input { font: inherit; }
.bda-page {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.55;
  overflow: hidden;
}

/* 左侧工作室导览栏 */
.bda-rail {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 14px 16px;
  background: var(--studio-rail);
  border-right: 1px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  min-height: 0;
}
.rail-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 8px;
}
.rail-mark {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(140deg, #0b3875, #009fd4);
  display: grid;
  place-items: center;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.28);
  flex: none;
}
.rail-brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rail-brand-name {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: -0.25px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-brand-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.6px;
  color: var(--lk-action);
  text-transform: uppercase;
}
.rail-ws-card {
  padding: 11px 12px;
  border-radius: 12px;
  background: var(--studio-surface);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--studio-shadow-sm);
}
.rail-ws-eyebrow {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.rail-ws-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
}
.rail-ws-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b9f1;
  box-shadow: 0 0 0 3px rgba(0, 185, 241, 0.18);
  flex: none;
}
.bda-ws {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rail-group-label {
  padding: 0 10px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
.rail-link {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color .14s, color .14s;
}
.rail-link:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.rail-link[data-active="true"] {
  background: var(--studio-surface);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--studio-shadow-sm);
  font-weight: 600;
}
.rail-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--lk-pale);
  color: var(--lk-action);
  font-variant-numeric: tabular-nums;
}
.rail-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.rail-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  display: flex;
  align-items: center;
  gap: 6px;
}
.rail-footer .bda-btn {
  flex: 1;
  justify-content: center;
}

/* 主滚动舞台 */
.bda-scroll {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scroll-behavior: smooth;
}
.bda-content {
  max-width: 1240px;
  margin: 0 auto;
  padding: 18px clamp(18px, 3vw, 38px) 64px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 顶栏 */
.bda-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px 20px;
}
.bda-heading-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bda-heading h1 {
  font-size: 23px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1.25;
}
.bda-subtitle {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}
.bda-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.bda-tool {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--studio-surface);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background-color .14s, border-color .14s, color .14s;
}
.bda-tool:hover, .bda-tool[aria-expanded=true] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l1);
}
.bda-tool[data-active=true]::after {
  content: "";
  position: absolute;
  top: 6px;
  right: 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lk-cyan);
}
.bda-search {
  display: flex;
  align-items: center;
  gap: 7px;
  width: min(270px, 46vw);
  height: 34px;
  padding: 0 9px 0 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--studio-surface);
  color: var(--dsw-alias-label-tertiary);
  transition: border-color .15s, box-shadow .15s;
}
.bda-search:focus-within {
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 3px rgba(0, 185, 241, 0.14);
}
.bda-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  outline: none;
}
.bda-search input::placeholder { color: var(--dsw-alias-label-caption); }
.bda-search input::-webkit-search-cancel-button { display: none; }
.bda-search button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: -3px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.bda-search button:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* 第一视觉核心：设计系统旗舰舞台 */
.ds-stage {
  display: grid;
  grid-template-columns: minmax(320px, 1.02fr) minmax(380px, 1.28fr);
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--studio-surface);
  box-shadow: var(--studio-shadow-md);
}
.ds-hero {
  position: relative;
  padding: 20px 24px 18px;
  background: linear-gradient(150deg, #0b3875 0%, #0e2c54 58%, #10243d 100%);
  color: #f4f9fc;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 14px;
  overflow: hidden;
}
.ds-hero-orbit {
  position: absolute;
  right: -76px;
  top: -68px;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  border: 1px solid rgba(108, 224, 255, 0.22);
  pointer-events: none;
}
.ds-hero-orbit::before {
  content: "";
  position: absolute;
  inset: 34px;
  border-radius: 50%;
  border: 1px dashed rgba(255, 255, 255, 0.18);
}
.ds-hero-orbit::after {
  content: "";
  position: absolute;
  top: 42px;
  left: 34px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #00b9f1;
  box-shadow: 0 0 24px 4px rgba(0, 185, 241, 0.65);
}
.ds-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  padding: 5px 11px;
  border-radius: 999px;
  background: rgba(0, 185, 241, 0.16);
  border: 1px solid rgba(108, 224, 255, 0.34);
  color: #8be4ff;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.8px;
}
.ds-eyebrow[data-ready="true"] {
  background: rgba(34, 197, 139, 0.18);
  border-color: rgba(110, 231, 183, 0.4);
  color: #8ef5cb;
}
.ds-brand-lockup {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 8px;
}
.ds-lakala-mark {
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -1px;
  color: #fff;
}
.ds-lakala-mark i {
  font-style: normal;
  color: #00b9f1;
}
.ds-hero h2 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.5px;
  line-height: 1.24;
  margin-top: 4px;
  color: #ffffff;
}
.ds-hero-desc {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.58;
  color: rgba(230, 243, 250, 0.84);
}
.ds-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}
.ds-stat {
  padding: 7px 10px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.065);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
  font-weight: 500;
  color: #e4f3fa;
  display: flex;
  align-items: center;
  gap: 7px;
}
.ds-stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00b9f1;
  flex: none;
}
.ds-cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ds-btn-cyan {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: #00b9f1;
  color: #072038;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: filter .14s, transform .14s;
}
.ds-btn-cyan:hover { filter: brightness(1.06); transform: translateY(-1px); }
.ds-btn-cyan:disabled { opacity: 0.6; cursor: progress; transform: none; }
.ds-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.07);
  color: #f0f8fc;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .14s, border-color .14s;
}
.ds-btn-ghost:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.36);
}

/* 设计系统右侧交互式规范实验室 */
.ds-lab {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--studio-surface);
}
.ds-lab-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface-2);
  flex-wrap: wrap;
}
.ds-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
}
.ds-tab {
  height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color .14s, color .14s;
}
.ds-tab[aria-selected="true"] {
  background: var(--studio-surface);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--studio-shadow-sm);
}
.ds-theme-switch {
  display: inline-flex;
  gap: 3px;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
}
.ds-theme-btn {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.ds-theme-btn[data-on="true"] {
  background: var(--lk-pale);
  color: var(--lk-action);
}
.ds-lab-body {
  flex: 1;
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ds-lab-body[data-token-theme="dark"] {
  background: #0f1d2a;
  color: #edf5f9;
}
.ds-hint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary);
}
.ds-lab-body[data-token-theme="dark"] .ds-hint-row { color: #8da6b8; }
.ds-swatches-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.ds-swatch-card {
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: rgba(128, 155, 175, 0.05);
  text-align: left;
  cursor: pointer;
  color: inherit;
  transition: transform .13s, border-color .13s;
}
.ds-swatch-card:hover {
  transform: translateY(-2px);
  border-color: var(--lk-cyan);
}
.ds-swatch-chip {
  width: 100%;
  height: 24px;
  border-radius: 6px;
  border: 1px solid rgba(16, 43, 70, 0.12);
  margin-bottom: 4px;
}
.ds-swatch-name {
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-swatch-hex {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  opacity: 0.72;
  margin-top: 1px;
}
.ds-type-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.ds-type-row {
  display: grid;
  grid-template-columns: 96px 76px minmax(0, 1fr);
  align-items: baseline;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 9px;
  background: rgba(128, 155, 175, 0.06);
}
.ds-type-token {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--lk-action);
}
.ds-type-spec {
  font-size: 11px;
  opacity: 0.72;
  font-variant-numeric: tabular-nums;
}
.ds-type-sample {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ds-scales-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  margin-top: 4px;
}
.ds-scale-box {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
}
.ds-scale-title {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.78;
  margin-bottom: 8px;
}
.ds-space-bars {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 44px;
}
.ds-space-bar {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
}
.ds-space-bar i {
  display: block;
  width: 100%;
  background: linear-gradient(180deg, #00b9f1, #007fa8);
  border-radius: 3px 3px 1px 1px;
}
.ds-radii-row {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ds-radius-chip {
  width: 36px;
  height: 36px;
  border: 1.5px solid #00b9f1;
  background: rgba(0, 185, 241, 0.1);
  display: grid;
  place-items: center;
  font-size: 9.5px;
  font-weight: 600;
}
.ds-comp-stage {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  gap: 12px;
}
.ds-comp-box {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ds-comp-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  opacity: 0.65;
}
.ds-demo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 15px;
  border-radius: 8px;
  border: 0;
  background: #007fa8;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.ds-demo-btn.sec {
  background: rgba(0, 185, 241, 0.14);
  color: inherit;
}
.ds-demo-input {
  width: 100%;
  height: 36px;
  padding: 0 11px;
  border-radius: 8px;
  border: 1px solid #9ab5c4;
  background: rgba(255, 255, 255, 0.92);
  color: #102b46;
  font-size: 12.5px;
}
.ds-link-more {
  align-self: flex-end;
  border: 0;
  background: none;
  color: var(--lk-action);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 0;
}
.ds-link-more:hover { text-decoration: underline; }

/* 板块标题行 */
.studio-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
  scroll-margin-top: 20px;
}
.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}
.bda-section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.25px;
  color: var(--dsw-alias-label-primary);
}
.section-sub {
  font-size: 12.5px;
  color: var(--dsw-alias-label-tertiary);
}

/* 快速新建磁贴 */
.bda-tiles {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  list-style: none;
}
.bda-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 14px;
  border-radius: 15px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: var(--studio-shadow-sm);
  transition: transform .15s, border-color .15s, box-shadow .15s;
}
.bda-tile:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--bda-tint) 55%, var(--dsw-alias-border-l1));
  box-shadow: var(--studio-shadow-md);
}
.bda-tile[data-featured="true"] {
  border-color: rgba(0, 185, 241, 0.45);
  background: linear-gradient(180deg, color-mix(in srgb, #00b9f1 8%, var(--studio-surface)), var(--studio-surface));
}
.bda-tile:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 2px;
}
.bda-tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bda-tile-art {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bda-tint) 16%, var(--studio-surface));
  color: color-mix(in srgb, var(--bda-tint) 82%, var(--dsw-alias-label-primary));
}
.bda-tile-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--lk-pale);
  color: var(--lk-action);
}
.bda-tile-label {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.bda-tile-about {
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 类型胶囊栏与工作区范围切换 */
.works-head-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.scope-switch {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface-2);
}
.scope-btn {
  height: 25px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color .14s, color .14s;
}
.scope-btn[data-on="true"] {
  background: var(--studio-surface);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--studio-shadow-sm);
}
.type-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.type-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color .14s, color .14s, border-color .14s;
}
.type-pill:hover {
  border-color: var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.type-pill[data-on="true"] {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
  color: var(--studio-surface);
}

/* 作品网格与列表 */
.bda-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 18px;
  list-style: none;
}
.bda-item { position: relative; min-width: 0; }
.bda-card {
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  overflow: hidden;
  background: var(--studio-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: var(--studio-shadow-sm);
  transition: transform .16s, border-color .16s, box-shadow .16s;
}
.bda-item:hover .bda-card {
  transform: translateY(-2px);
  border-color: var(--dsw-alias-border-l1);
  box-shadow: var(--studio-shadow-md);
}
.bda-card:disabled { cursor: progress; }
.bda-card:focus-visible, .bda-row:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);
  outline-offset: 2px;
}
.bda-preview {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16/10;
  overflow: hidden;
  background: color-mix(in srgb, var(--bda-tint) 13%, var(--dsw-alias-bg-skeleton));
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.bda-thumb { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 2; }
.bda-live {
  position: absolute;
  inset: 0;
  width: 1280px;
  height: 800px;
  transform-origin: 0 0;
  border: 0;
  background: #fff;
  pointer-events: none;
  opacity: 0;
  transition: opacity .3s;
  z-index: 1;
}
.bda-live.on { opacity: 1; }
.bda-sheet {
  position: absolute;
  left: 11%;
  right: 11%;
  top: 14%;
  bottom: -8px;
  border-radius: 9px 9px 0 0;
  overflow: hidden;
  background: var(--studio-surface);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2), 0 8px 20px -8px rgba(0, 0, 0, .24);
  transition: transform .2s;
}
.bda-item:hover .bda-sheet { transform: translateY(-3px); }
.bda-slide, .bda-film, .bda-paper {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 16px;
  overflow: hidden;
}
.bda-paper-title, .bda-film-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bda-line {
  margin-top: auto;
  width: 48%;
  height: 4px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--bda-tint) 65%, var(--studio-surface));
}
.bda-boards, .bda-swatches, .bda-kpis { display: flex; gap: 6px; margin-top: auto; }
.bda-board { flex: 1; height: 28px; border-radius: 4px; border: 1px dashed var(--dsw-alias-border-l1); background: var(--dsw-alias-interactive-bg-hover); }
.bda-swatch { width: 16px; height: 16px; border-radius: 50%; background: var(--bda-tint); }
.bda-swatch:nth-child(2) { opacity: .6; }
.bda-swatch:nth-child(3) { opacity: .3; }
.bda-kpi { flex: 1; height: 24px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); border: 1px solid var(--dsw-alias-border-l2); }
.bda-film { background: #101820; color: #fff; align-items: center; justify-content: center; }
.bda-film-title { color: #eee; width: 100%; text-align: center; margin-bottom: 4px; }
.bda-film-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--bda-tint); }
.bda-scope-tag {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 3;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  background: rgba(16, 43, 70, 0.72);
  color: #fff;
  backdrop-filter: blur(6px);
}
.bda-scope-tag[data-current="true"] {
  background: rgba(0, 127, 168, 0.88);
}
.bda-busy {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(11, 24, 38, .66);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.bda-spinner {
  width: 13px;
  height: 13px;
  border: 1.8px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.bda-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 13px;
  min-width: 0;
}
.bda-glyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bda-tint) 14%, transparent);
  color: var(--bda-tint);
}
.bda-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bda-name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 19px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bda-meta {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bda-actions {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity .15s;
}
.bda-item:hover .bda-actions,
.bda-item[data-menu="true"] .bda-actions,
.bda-item:focus-within .bda-actions,
.bda-item[data-pinned="true"] .bda-actions {
  opacity: 1;
}
.bda-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--studio-surface);
  box-shadow: 0 2px 6px rgba(0,0,0,.14);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.bda-act:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
.bda-act[data-on=true] { color: var(--lk-action); border-color: rgba(0, 185, 241, 0.45); }

.bda-list { display: flex; flex-direction: column; gap: 7px; list-style: none; }
.bda-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 92px 10px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--studio-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color .14s, border-color .14s;
}
.bda-row:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }
.bda-row .bda-name { flex: 1; min-width: 0; }
.bda-row .bda-meta { flex: none; margin-left: 12px; }
.bda-row-tools {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 失效记录治理托盘（处理全部“文件已不在”问题） */
.missing-tray {
  margin-top: 6px;
  border-radius: 14px;
  border: 1px solid light-dark(rgba(197, 48, 66, 0.24), rgba(248, 113, 133, 0.28));
  background: light-dark(#fff8f9, rgba(197, 48, 66, 0.08));
  overflow: hidden;
}
.missing-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 12px 16px;
}
.missing-bar-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.missing-bar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.bda-missing-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-error-primary);
  color: #fff;
}
.missing-bar-desc {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.missing-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.missing-list {
  list-style: none;
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bda-item.bda-missing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--studio-surface);
  border: 1px solid var(--dsw-alias-border-l2);
}
.missing-item-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.missing-item-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 预置精选示例大画幅卡片 */
#examples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 18px;
  list-style: none;
}
.bda-example {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  overflow: hidden;
  background: var(--studio-surface);
  box-shadow: var(--studio-shadow-sm);
  transition: transform .16s, border-color .16s, box-shadow .16s;
}
.bda-example:hover {
  transform: translateY(-2px);
  border-color: var(--dsw-alias-border-l1);
  box-shadow: var(--studio-shadow-md);
}
.bda-example-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16/10;
  overflow: hidden;
  background: var(--dsw-alias-bg-skeleton);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  cursor: pointer;
}
.bda-example-stage iframe {
  position: absolute;
  left: 0;
  top: 0;
  width: 1200px;
  height: 750px;
  border: 0;
  transform-origin: 0 0;
  pointer-events: none;
  opacity: 1;
  background: #fff;
}
.bda-example-label {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 2;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(16, 43, 70, 0.78);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  backdrop-filter: blur(4px);
}
.bda-example-body {
  padding: 15px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.bda-example-skill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--lk-action);
}
.bda-example h3 { font-size: 15px; font-weight: 700; letter-spacing: -0.2px; }
.bda-example p { font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.bda-example-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: auto;
  padding-top: 8px;
}

/* AI 跨技能工作流卡片 */
#recipes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
  list-style: none;
}
.recipe-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 16px;
  border-radius: 15px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform .15s, border-color .15s, box-shadow .15s;
}
.recipe-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 185, 241, 0.45);
  box-shadow: var(--studio-shadow-md);
}
.recipe-step {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  color: var(--lk-action);
}
.recipe-title { font-size: 14.5px; font-weight: 700; margin-top: 4px; }
.bda-recipe-desc { font-size: 12.5px; color: var(--dsw-alias-label-secondary); line-height: 1.55; margin-top: 4px; }
.recipe-foot {
  font-size: 12px;
  font-weight: 600;
  color: var(--lk-action);
}

/* 菜单、弹窗、Toast 与全屏内嵌编辑器 */
.bda-menu {
  position: fixed;
  z-index: 1000;
  min-width: 210px;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 13px;
  background: var(--studio-surface);
  box-shadow: var(--studio-shadow-md);
  font-size: 13.5px;
}
.bda-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.bda-menu-item:hover, .bda-menu-item:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.bda-menu-item[data-danger=true] { color: var(--dsw-alias-state-error-primary); }
.bda-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.bda-menu-value { margin-left: 16px; color: var(--dsw-alias-label-tertiary); font-size: 12.5px; }
.bda-menu-count { margin-left: 16px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.bda-menu-key { margin-left: 20px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.bda-menu-rule { height: 1px; margin: 6px 4px; background: var(--dsw-alias-border-l2); }
.bda-menu-chev { margin-left: 6px; color: var(--dsw-alias-label-tertiary); }
.bda-menu-row { position: relative; }
.bda-submenu {
  position: absolute;
  left: calc(100% + 8px);
  top: -6px;
  z-index: 1001;
  min-width: 190px;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 13px;
  background: var(--studio-surface);
  box-shadow: var(--studio-shadow-md);
  display: none;
}
.bda-menu-row:hover .bda-submenu { display: block; }
.bda-check {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px;
  color: transparent;
}
.bda-check[data-on=true] {
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
}
.bda-tick { flex: none; margin-left: 16px; color: var(--dsw-alias-state-business-primary); }

.bda-scrim {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(8, 18, 28, .52);
  backdrop-filter: blur(4px);
}
.bda-scrim p { max-width: 46em; line-height: 1.7; }
.bda-dialog {
  width: min(460px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 22px;
  border-radius: 18px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
  box-shadow: 0 24px 64px -12px rgba(0,0,0,.45);
}
.bda-dialog.wide { width: min(940px, 100%); }
.bda-dialog h2 { margin: 0 0 10px; font-size: 17px; font-weight: 700; line-height: 1.35; }
.bda-dialog p { margin: 0 0 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.bda-dialog input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  outline: none;
  margin-bottom: 16px;
}
.bda-dialog input:focus { border-color: var(--dsw-alias-state-business-primary); }
.bda-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.bda-example-preview {
  overflow: hidden;
  width: 100%;
  background: var(--dsw-alias-bg-skeleton);
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  margin-bottom: 12px;
}
.bda-example-preview iframe { width: 1200px; height: 750px; border: 0; transform-origin: top left; background: #fff; }
.bda-example-skeleton { padding: 24px; background: var(--dsw-alias-bg-skeleton); border-radius: 10px; margin-bottom: 12px; }

.bda-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 33px;
  padding: 0 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--studio-surface-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color .14s, border-color .14s;
}
.bda-btn:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }
.bda-btn:disabled { opacity: 0.55; cursor: default; }
.bda-btn[data-primary=true] {
  border-color: transparent;
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
}
.bda-btn[data-primary=true]:hover { filter: brightness(1.07); }
.bda-btn[data-danger=true] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--studio-surface));
  color: var(--dsw-alias-state-error-primary);
}

.bda-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100% - 32px));
  padding: 10px 12px 10px 15px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--studio-surface);
  box-shadow: var(--studio-shadow-md);
  transform: translateX(-50%);
  font-size: 13px;
  font-weight: 500;
}
.bda-toast-undo {
  padding: 3px 9px;
  border: 0;
  border-radius: 6px;
  background: var(--lk-pale);
  color: var(--lk-action);
  font-weight: 600;
  cursor: pointer;
}
.bda-toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.bda-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 20px;
  border-radius: 16px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--studio-surface) 65%, transparent);
  text-align: center;
  color: var(--dsw-alias-label-tertiary);
}
.bda-empty h2 { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.bda-empty p { max-width: 440px; font-size: 13px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
.bda-empty-compact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 13px 16px;
  border-radius: 14px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--studio-surface) 72%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
}
.bda-empty-compact-copy {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.bda-empty-compact-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

#editorView {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  position: absolute;
  inset: 0;
  z-index: 500;
  background: var(--dsw-alias-bg-base);
}
.editor-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--studio-surface);
  flex: none;
}
.editor-bar .title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
#frame { flex: 1; border: 0; width: 100%; height: 100%; background: var(--dsw-alias-bg-base); }
.hidden { display: none !important; }

@supports (text-autospace: normal) or (text-spacing-trim: space-all) {
  .bda-scrim p, .bda-name, .bda-meta, .ds-hero-desc {
    text-autospace: normal;
    text-spacing-trim: space-all;
  }
}

@media (max-width: 1060px) {
  .ds-stage { grid-template-columns: 1fr; }
  .bda-tiles { grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); }
}
@media (max-width: 820px) {
  .bda-page { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .bda-rail {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 8px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l2);
  }
  .rail-brand { padding: 0; gap: 8px; }
  .rail-brand-tag { display: none; }
  .rail-ws-card, .rail-skills-box { display: none; }
  .rail-nav {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
  }
  .rail-nav .rail-link {
    width: auto;
    padding: 5px 8px;
    gap: 5px;
    font-size: 12px;
    white-space: nowrap;
  }
  .rail-footer { margin-top: 0; margin-left: auto; padding-top: 0; border-top: 0; flex: none; }
  .ds-swatches-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ds-comp-stage, .ds-scales-row { grid-template-columns: 1fr; }
}
`;

function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function safeJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

const GALLERY_CLIENT_SCRIPT = String.raw`
function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

const requestedLang = new URLSearchParams(location.search).get('lang');
const rememberedLang = readPreference('ps_lang');
let lang = Object.hasOwn(STR, requestedLang) ? requestedLang : Object.hasOwn(STR, rememberedLang) ? rememberedLang : INITIAL_LANG;
writePreference('ps_lang', lang);

function locale() { return lang === 'en' ? 'en' : 'zh-CN'; }
function t(key, values = {}) {
  const text = STR[lang][key] ?? STR.zh[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}
function skillText(id, field) { return STR[lang]['skill.' + id + '.' + field] ?? id; }
function exampleText(example, field) { return STR[lang]['example.' + example.id + '.' + field] ?? example[field] ?? ''; }

const SKILL_MAP = Object.fromEntries(SKILLS_CONFIG.map((s) => [s.id, s]));

function currentEffectiveScheme() {
  const explicit = document.documentElement.dataset.scheme;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  const host = document.documentElement.dataset.hostScheme;
  if (host === 'dark' || host === 'light') return host;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

(() => {
  try {
    const q = new URLSearchParams(location.search).get('scheme');
    const s = q === 'dark' || q === 'light' ? q : '';
    if (s) { localStorage.setItem('ps-scheme', s); localStorage.setItem('ps-scheme-manual', '1'); }
    const saved = s || (localStorage.getItem('ps-scheme-manual') ? localStorage.getItem('ps-scheme') : '');
    const host = document.documentElement.dataset.hostScheme || '';
    const resolved = saved || (host === 'dark' || host === 'light' ? host : '');
    if (resolved) document.documentElement.dataset.scheme = resolved;
  } catch {}
})();

const SVG_ICONS = {
  search: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>',
  filter: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>',
  grid: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>',
  list: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5.75 4h7.75M5.75 8h7.75M5.75 12h7.75"/><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke-width="1.8"/></svg>',
  pin: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4"/></svg>',
  pinFilled: '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M9.75 2.25 13.75 6.25M10.75 3.25 7 6.25 4.5 6.5 9.5 11.5 9.75 9 12.75 5.25M7 9l-4 4"/></svg>',
  more: '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><circle cx="3.5" cy="8" r=".9"/><circle cx="8" cy="8" r=".9"/><circle cx="12.5" cy="8" r=".9"/></svg>',
  rename: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M10.5 3 13 5.5 5.5 13 2.5 13.5 3 10.5 10.5 3Z"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.25-2.25a2.5 2.5 0 0 0-3.54-3.54L8.25 4.2M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.46 9a2.5 2.5 0 0 0 3.54 3.54l.75-.75"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4 4.25l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.75 7v4M9.25 7v4"/></svg>',
  tick: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m3 8.5 3.25 3.25L13 4.75"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>',
  info: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.25M8 5.25h.01"/></svg>',
  sun: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M12.4 3.6l-1.05 1.05M4.65 11.35 3.6 12.4"/></svg>',
  moon: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M13.2 10.1A5.5 5.5 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3Z"/></svg>',
  spark: '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2l1.3 3.4L12.7 6.7 9.3 8 8 11.4 6.7 8 3.3 6.7l3.4-1.3L8 2z"/><path d="M12.5 10.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z"/></svg>',
};

function typeIconSvg(skill, size = 18) {
  const p = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  let inner = '';
  switch (skill) {
    case 'claude-slides':
      inner = '<path d="M2.75 3.5h14.5M4 3.5v8.25a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3.5M7.25 16.75 10 12.75l2.75 4" ' + p + '/>';
      break;
    case 'claude-design':
      inner = '<path d="M10 2.75a7.25 7.25 0 1 0 0 14.5c1.1 0 1.75-.8 1.75-1.7 0-.5-.2-.9-.45-1.25-.25-.35-.45-.7-.45-1.15 0-.95.75-1.65 1.7-1.65h1.6a3.1 3.1 0 0 0 3.1-3.1c0-3.1-3.2-5.65-7.25-5.65Z" ' + p + '/><circle cx="6.4" cy="9.4" r=".9" fill="currentColor"/><circle cx="8.8" cy="6.3" r=".9" fill="currentColor"/><circle cx="12.5" cy="6.8" r=".9" fill="currentColor"/>';
      break;
    case 'claude-design-system':
      inner = '<circle cx="6.5" cy="6.5" r="3.25" ' + p + '/><circle cx="13.5" cy="6.5" r="3.25" ' + p + '/><circle cx="10" cy="13" r="3.25" ' + p + '/>';
      break;
    case 'claude-dashboard':
      inner = '<rect x="2.75" y="10" width="4.5" height="7.25" rx="1" ' + p + '/><rect x="7.75" y="2.75" width="4.5" height="14.5" rx="1" ' + p + '/><rect x="12.75" y="7" width="4.5" height="10.25" rx="1" ' + p + '/>';
      break;
    case 'claude-motion':
      inner = '<rect x="2.75" y="4" width="14.5" height="12" rx="2" ' + p + '/><path d="m8.5 7.75 4 2.25-4 2.25v-4.5Z" ' + p + '/>';
      break;
    default:
      inner = '<rect x="3" y="3" width="14" height="14" rx="2" ' + p + '/>';
  }
  return '<svg viewBox="0 0 20 20" width="' + size + '" height="' + size + '" fill="none" style="display:block;flex:none">' + inner + '</svg>';
}

function drawnHtml(skill, title) {
  const escTitle = esc(title);
  switch (skill) {
    case 'claude-slides':
      return '<div class="bda-slide"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-line"></div></div>';
    case 'claude-design':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-boards"><div class="bda-board"></div><div class="bda-board"></div></div></div>';
    case 'claude-design-system':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-swatches"><span class="bda-swatch"></span><span class="bda-swatch"></span><span class="bda-swatch"></span></div></div>';
    case 'claude-dashboard':
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div><div class="bda-kpis"><span class="bda-kpi"></span><span class="bda-kpi"></span></div></div>';
    case 'claude-motion':
      return '<div class="bda-film"><div class="bda-film-title">' + escTitle + '</div><svg viewBox="0 0 20 20" width="22" height="22" style="display:block;margin:auto"><path d="M7 5.5v9l7.5-4.5L7 5.5Z" fill="currentColor"/></svg><div class="bda-film-bar"></div></div>';
    default:
      return '<div class="bda-paper"><div class="bda-paper-title">' + escTitle + '</div></div>';
  }
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ago(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  if (seconds > -60) return t('justOpened');
  const steps = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2629800], ['year', 31557600]];
  let unit = 'minute', size = 60;
  for (const [u, s] of steps) if (-seconds >= s) [unit, size] = [u, s];
  let time;
  try {
    time = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(Math.round(seconds / size), unit);
  } catch {
    const key = unit === 'week' ? 'weekUnit' : unit === 'month' ? 'monthUnit' : unit;
    time = t('relativeFallback', { count: Math.abs(Math.round(seconds / size)), unit: t(key) });
  }
  return t('openedRelative', { time });
}

function localizedMeta(item) {
  const match = /^(\d+) /.exec(item.meta || '');
  const keys = { 'claude-design': 'boards', 'claude-slides': 'pages', 'claude-motion': 'scenes', 'claude-design-system': 'components', 'claude-dashboard': 'sheets' };
  if (match && keys[item.skill]) return t(keys[item.skill], { count: match[1] });
  return item.skill === 'claude-dashboard' && item.meta ? t('dashboard') : item.meta || '';
}

const state = {
  artifacts: [],
  workspaceName: '',
  workspaceRoot: '',
  scope: 'workspace',
  search: '',
  viewMode: readPreference('ps_view_mode') || 'grid',
  filters: {
    sort: 'opened',
    types: [],
    date: 'any',
    sharing: 'any',
    pinned: false,
  },
  openingRoot: null,
  dsTab: 'colors',
  dsTheme: currentEffectiveScheme(),
  dsCreating: false,
  showMissingDetails: false,
};

async function api(route, opts) {
  const r = await fetch(route, opts);
  return r.json();
}

function showToast(msg, undoTrashId) {
  const toast = document.getElementById('toast');
  toast.innerHTML = '<span style="display:inline-flex;align-items:center">' + SVG_ICONS.info + '</span><span class="bda-toast-text">' + esc(msg) + '</span>' +
    (undoTrashId ? ('<button type="button" class="bda-toast-undo" id="toastUndoBtn">' + t('undo') + '</button>') : '') +
    '<button type="button" class="bda-toast-close" id="toastCloseBtn"><svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.3"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg></button>';
  toast.className = 'bda-toast';
  document.getElementById('toastCloseBtn').onclick = () => { toast.className = 'hidden'; };
  if (undoTrashId) {
    document.getElementById('toastUndoBtn').onclick = async () => {
      toast.className = 'hidden';
      const r = await api('/api/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: undoTrashId }) });
      if (r.ok) {
        showToast(t('restored'));
        await reload();
      } else {
        showToast(t('restoreFailed') + (r.error || ''));
      }
    };
  }
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'hidden'; }, undoTrashId ? 10000 : 3500);
}

function closeDialog() {
  const scrim = document.getElementById('dialogScrim');
  scrim.className = 'bda-scrim hidden';
  scrim.innerHTML = '';
}

function openDialog(html, wide = false) {
  const scrim = document.getElementById('dialogScrim');
  scrim.innerHTML = '<div class="bda-dialog' + (wide ? ' wide' : '') + '">' + html + '</div>';
  scrim.className = 'bda-scrim';
  scrim.onclick = (e) => { if (e.target === scrim) closeDialog(); };
}

function closeMenu() {
  document.getElementById('menuLayer').innerHTML = '';
  document.querySelectorAll('.bda-item[data-menu="true"]').forEach((el) => el.removeAttribute('data-menu'));
}
window.addEventListener('click', (e) => {
  if (!e.target.closest('.bda-menu') && !e.target.closest('.bda-tool') && !e.target.closest('.bda-act')) {
    closeMenu();
  }
});

function validArtifacts() {
  return state.artifacts.filter((a) => !a.missing);
}
function workspaceArtifacts() {
  const all = validArtifacts();
  return state.workspaceRoot ? all.filter((a) => a.inCurrentWorkspace) : all;
}
function scopedArtifacts() {
  const all = validArtifacts();
  if (state.workspaceRoot && state.scope === 'workspace') {
    return all.filter((a) => a.inCurrentWorkspace);
  }
  return all;
}
function missingArtifacts() {
  return state.artifacts.filter((a) => a.missing);
}
function activeWorkspaceDesignSystem() {
  return validArtifacts().find((a) =>
    a.skill === 'claude-design-system' &&
    a.inCurrentWorkspace &&
    (/lakala|拉卡拉/i.test(a.title) || /lakala-design-system/i.test(a.root))
  ) || null;
}

function matchesFilter(item) {
  if (item.missing) return false;
  if (state.workspaceRoot && state.scope === 'workspace' && !item.inCurrentWorkspace) return false;
  const q = state.search.trim().toLowerCase();
  if (q) {
    const hay = (item.title + ' ' + (item.tail || '') + ' ' + item.skill).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (state.filters.pinned && !item.pinned) return false;
  if (state.filters.types.length && !state.filters.types.includes(item.skill)) return false;
  if (state.filters.sharing !== 'any') {
    if (state.filters.sharing === 'shared' && !item.shared) return false;
    if (state.filters.sharing === 'private' && item.shared) return false;
  }
  if (state.filters.date !== 'any') {
    const then = Date.parse(item.openedAt);
    if (!Number.isFinite(then)) return false;
    const now = Date.now();
    const day = new Date(now);
    const today = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const DAY = 86400000;
    if (state.filters.date === 'today' && then < today) return false;
    if (state.filters.date === 'yesterday' && (then < today - DAY || then >= today)) return false;
    if (state.filters.date === 'week' && then < now - 7 * DAY) return false;
    if (state.filters.date === 'month' && then < now - 30 * DAY) return false;
  }
  return true;
}

function getSortedList() {
  const list = validArtifacts().filter(matchesFilter);
  const sort = state.filters.sort;
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'name') return a.title.localeCompare(b.title, locale());
    const key = sort === 'updated' ? 'updatedAt' : (sort === 'created' ? 'firstOpenedAt' : 'openedAt');
    return (b[key] || '').localeCompare(a[key] || '');
  });
  return list;
}

function isFilterActive() {
  return state.filters.sort !== 'opened' || state.filters.types.length > 0 ||
    state.filters.date !== 'any' || state.filters.sharing !== 'any' || state.filters.pinned;
}

function tokenHex(token, mode) {
  if (typeof token.value === 'object' && token.value !== null) {
    return token.value[mode] || token.value.light || '';
  }
  return String(token.value || '');
}

function renderSchemeButton() {
  const btn = document.getElementById('schemeBtn');
  if (!btn) return;
  const dark = currentEffectiveScheme() === 'dark';
  btn.innerHTML = dark ? SVG_ICONS.sun : SVG_ICONS.moon;
}

function renderRailSkills() {
  const valid = scopedArtifacts();
  const counts = new Map();
  valid.forEach((a) => counts.set(a.skill, (counts.get(a.skill) || 0) + 1));
  const worksBadge = document.getElementById('railWorksCount');
  if (worksBadge) worksBadge.textContent = String(valid.length);

  const activeSingle = state.filters.types.length === 1 ? state.filters.types[0] : '';
  const allOn = state.filters.types.length === 0;

  const railEl = document.getElementById('railSkillLinks');
  if (railEl) {
    railEl.innerHTML =
      '<button type="button" class="rail-link" data-skill-filter="" data-active="' + allOn + '">' +
      '<span class="rail-link-label">' + esc(t('allTypes')) + '</span>' +
      '<span class="rail-count">' + valid.length + '</span></button>' +
      SKILLS_CONFIG.map((s) =>
        '<button type="button" class="rail-link" data-skill-filter="' + esc(s.id) + '" data-active="' + (activeSingle === s.id) + '">' +
        '<span style="color:' + (TINTS[s.id] || 'currentColor') + ';display:inline-flex">' + typeIconSvg(s.id, 15) + '</span>' +
        '<span class="rail-link-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(skillText(s.id, 'name')) + '</span>' +
        '<span class="rail-count">' + (counts.get(s.id) || 0) + '</span></button>'
      ).join('');
  }

  const pillsEl = document.getElementById('typePills');
  if (pillsEl) {
    pillsEl.innerHTML =
      '<button type="button" class="type-pill" data-skill-pill="" data-on="' + allOn + '">' +
      esc(t('allTypes')) + ' · ' + valid.length + '</button>' +
      SKILLS_CONFIG.map((s) =>
        '<button type="button" class="type-pill" data-skill-pill="' + esc(s.id) + '" data-on="' + state.filters.types.includes(s.id) + '">' +
        typeIconSvg(s.id, 13) +
        '<span>' + esc(skillText(s.id, 'name')) + '</span>' +
        '<span style="opacity:.7">' + (counts.get(s.id) || 0) + '</span></button>'
      ).join('');
  }
}

function renderDesignSystemStage() {
  const activeDs = activeWorkspaceDesignSystem();
  const eyebrow = document.getElementById('dsEyebrow');
  const eyebrowText = document.getElementById('dsEyebrowText');
  const heroTitle = document.getElementById('dsHeroTitle');
  const heroDesc = document.getElementById('dsHeroDesc');
  const primaryBtn = document.getElementById('dsPrimaryBtn');

  if (activeDs && activeDs.inCurrentWorkspace) {
    eyebrow.setAttribute('data-ready', 'true');
    eyebrowText.textContent = t('dsEyebrowActive');
    heroTitle.textContent = activeDs.title;
    heroDesc.textContent = t('dsActiveDesc', { title: activeDs.title });
    primaryBtn.textContent = state.dsCreating ? t('opening') : t('dsOpenBtn');
  } else {
    eyebrow.setAttribute('data-ready', 'false');
    eyebrowText.textContent = t('dsEyebrowDefault');
    heroTitle.textContent = t('dsHeroTitle');
    heroDesc.textContent = t('dsHeroDesc');
    primaryBtn.textContent = state.dsCreating ? t('creating') : t('dsInitBtn');
  }
  primaryBtn.disabled = state.dsCreating;

  document.querySelectorAll('[data-ds-tab]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.getAttribute('data-ds-tab') === state.dsTab ? 'true' : 'false');
  });
  document.querySelectorAll('[data-ds-theme]').forEach((btn) => {
    btn.setAttribute('data-on', btn.getAttribute('data-ds-theme') === state.dsTheme ? 'true' : 'false');
  });

  renderDsLab();
}

function renderDsLab() {
  const body = document.getElementById('dsLabBody');
  if (!body) return;
  const mode = state.dsTheme === 'dark' ? 'dark' : 'light';
  body.setAttribute('data-token-theme', mode);

  const colors = (LAKALA_TOKENS.color && LAKALA_TOKENS.color.tokens) || [];
  if (state.dsTab === 'colors') {
    body.innerHTML =
      '<div class="ds-hint-row"><span>' + esc(t('dsCopyHint')) + '</span><span style="font-family:ui-monospace,monospace">lakala.com · ' + mode.toUpperCase() + '</span></div>' +
      '<div class="ds-swatches-grid">' +
      colors.map((tk) => {
        const hex = tokenHex(tk, mode);
        return '<button type="button" class="ds-swatch-card" data-copy-token="' + esc(tk.name) + '" data-copy-hex="' + esc(hex) + '" title="' + esc(tk.usage || tk.name) + '">' +
          '<span class="ds-swatch-chip" style="background:' + esc(hex) + '"></span>' +
          '<span class="ds-swatch-name">--' + esc(tk.name) + '</span>' +
          '<span class="ds-swatch-hex">' + esc(hex.toUpperCase()) + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
    return;
  }

  if (state.dsTab === 'type') {
    const styles = (LAKALA_TOKENS.type && LAKALA_TOKENS.type.groups && LAKALA_TOKENS.type.groups[0] && LAKALA_TOKENS.type.groups[0].styles) || [];
    const spaces = (LAKALA_TOKENS.spacing && LAKALA_TOKENS.spacing.tokens) || [];
    const radii = (LAKALA_TOKENS.radius && LAKALA_TOKENS.radius.tokens) || [];
    body.innerHTML =
      '<div class="ds-type-list">' +
      styles.slice(0, 6).map((st) => {
        const rawPx = parseInt(st.fontSize, 10) || 16;
        const previewPx = Math.min(26, Math.max(12, Math.round(rawPx * 0.52)));
        return '<div class="ds-type-row">' +
          '<span class="ds-type-token">' + esc(st.name) + '</span>' +
          '<span class="ds-type-spec">' + esc(st.fontSize) + ' / ' + esc(st.lineHeight) + '</span>' +
          '<span class="ds-type-sample" style="font-size:' + previewPx + 'px;font-weight:' + esc(st.fontWeight) + '">' + esc(st.usage || 'Lakala Digital Commerce') + '</span>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<div class="ds-scales-row">' +
      '<div class="ds-scale-box"><div class="ds-scale-title">' + esc(t('dsScaleSpacing')) + '</div>' +
      '<div class="ds-space-bars">' +
      spaces.slice(0, 8).map((sp) => {
        const n = parseInt(sp.value, 10) || 4;
        const h = Math.max(4, Math.round((n / 64) * 30));
        return '<span class="ds-space-bar"><i style="height:' + h + 'px"></i><span>' + n + '</span></span>';
      }).join('') +
      '</div></div>' +
      '<div class="ds-scale-box"><div class="ds-scale-title">' + esc(t('dsScaleRadius')) + '</div>' +
      '<div class="ds-radii-row">' +
      radii.map((rd) => {
        const n = parseInt(rd.value, 10) || 4;
        return '<span class="ds-radius-chip" style="border-radius:' + Math.min(18, Math.round(n * 0.6)) + 'px">' + n + '</span>';
      }).join('') +
      '</div></div>' +
      '</div>';
    return;
  }

  const map = Object.fromEntries(colors.map((tk) => [tk.name, tokenHex(tk, mode)]));
  const actionBg = map['brand-action'] || '#007fa8';
  const actionFg = mode === 'dark' ? '#072038' : '#ffffff';
  const cardBg = map['surface-subtle'] || (mode === 'dark' ? '#172a39' : '#f5f8fa');
  const borderCol = map['border-default'] || '#d7e3ea';
  const okCol = map['state-success'] || '#15734f';
  body.innerHTML =
    '<div class="ds-comp-stage">' +
    '<div class="ds-comp-box" style="background:' + esc(cardBg) + ';border-color:' + esc(borderCol) + '">' +
    '<span class="ds-comp-label">BUTTONS &amp; STATES</span>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
    '<button type="button" class="ds-demo-btn" style="background:' + esc(actionBg) + ';color:' + esc(actionFg) + '">立即开通收款</button>' +
    '<button type="button" class="ds-demo-btn sec">查看费率明细</button>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:2px">' +
    '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-weight:600;color:' + esc(okCol) + ';background:rgba(21,115,79,0.12)">● 实时清分正常 · T+1</span>' +
    '<span style="opacity:.72">AA 4.8:1</span>' +
    '</div>' +
    '</div>' +
    '<div class="ds-comp-box" style="background:' + esc(cardBg) + ';border-color:' + esc(borderCol) + '">' +
    '<span class="ds-comp-label">FORM &amp; METRIC CARD</span>' +
    '<input class="ds-demo-input" readonly value="lakala.merchant@store-01.cn" aria-label="Merchant account">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-top:2px">' +
    '<span style="font-size:11.5px;opacity:.72">今日净收款额</span>' +
    '<strong style="font-size:19px;letter-spacing:-0.5px;color:' + esc(map['brand-primary'] || '#00b9f1') + '">¥ 128,460.00</strong>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<button type="button" class="ds-link-more" id="dsMoreCompsBtn">' + esc(t('dsOpenAllComps')) + '</button>';
  const moreBtn = document.getElementById('dsMoreCompsBtn');
  if (moreBtn) moreBtn.onclick = () => openDsInspectorDialog('Button');
}

function openDsInspectorDialog(initialComp = 'Cover') {
  const names = Object.keys(DS_COMPONENTS);
  if (!names.length) return;
  let current = DS_COMPONENTS[initialComp] ? initialComp : names[0];
  const activeDs = activeWorkspaceDesignSystem();

  const renderModal = () => {
    openDialog(
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">' +
      '<h2 style="margin:0">' + esc(t('dsHeroTitle')) + '</h2>' +
      '<div class="ds-tabs" id="dsModalTabs">' +
      names.map((n) =>
        '<button type="button" class="ds-tab" data-modal-comp="' + esc(n) + '" aria-selected="' + (n === current) + '">' + esc(n) + '</button>'
      ).join('') +
      '</div></div>' +
      '<p>' + esc(t('dsModalSubtitle')) + '</p>' +
      '<div class="bda-example-preview" id="dsModalPreview"><iframe sandbox="" title="' + esc(current) + '"></iframe></div>' +
      '<div class="bda-dialog-actions">' +
      '<button type="button" class="bda-btn" id="dsModalClose">' + esc(t('close')) + '</button>' +
      '<button type="button" class="bda-btn" data-primary="true" id="dsModalOpenBtn">' +
      esc(activeDs && activeDs.inCurrentWorkspace ? t('dsOpenBtn') : t('dsInitBtn')) + '</button>' +
      '</div>',
      true
    );
    document.getElementById('dsModalClose').onclick = closeDialog;
    document.getElementById('dsModalOpenBtn').onclick = async () => {
      closeDialog();
      await triggerPrimaryDesignSystemAction();
    };
    document.getElementById('dsModalTabs').onclick = (e) => {
      const b = e.target.closest('[data-modal-comp]');
      if (!b) return;
      current = b.getAttribute('data-modal-comp');
      renderModal();
    };
    const preview = document.getElementById('dsModalPreview');
    const frame = preview.querySelector('iframe');
    const scale = Math.min(1, (preview.clientWidth || 860) / 1120);
    frame.style.width = '1120px';
    frame.style.height = '680px';
    preview.style.height = Math.round(680 * scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.srcdoc = DS_COMPONENTS[current] || '';
  };
  renderModal();
}

async function triggerPrimaryDesignSystemAction() {
  const activeDs = activeWorkspaceDesignSystem();
  if (activeDs && activeDs.inCurrentWorkspace) {
    await openItem(activeDs);
    return;
  }
  await instantiateTemplate('claude-design-system', true);
}

async function instantiateTemplate(templateId, openAfter = true) {
  state.dsCreating = templateId === 'claude-design-system';
  renderDesignSystemStage();
  try {
    const res = await api('/api/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill: templateId }),
    });
    if (res.ok && res.root) {
      await reload();
      const created = state.artifacts.find((a) => a.root === res.root);
      showToast(t('exampleCreatedToast', { title: created ? created.title : templateId }));
      if (openAfter && created) await openItem(created);
    } else {
      showToast(t('createFailed') + (res.error || t('unknownError')));
    }
  } catch (err) {
    showToast(t('createFailed') + err.message);
  } finally {
    state.dsCreating = false;
    renderDesignSystemStage();
  }
}

function renderTiles() {
  const ordered = [
    ...SKILLS_CONFIG.filter((s) => s.id === 'claude-design-system'),
    ...SKILLS_CONFIG.filter((s) => s.id !== 'claude-design-system'),
  ];
  const ul = document.getElementById('tiles');
  ul.innerHTML = ordered.map((s) => {
    const featured = s.id === 'claude-design-system';
    return '<li style="--bda-tint:' + s.tint + '">' +
      '<button type="button" class="bda-tile" data-skill="' + esc(s.id) + '" data-featured="' + featured + '">' +
      '<span class="bda-tile-top">' +
      '<span class="bda-tile-art">' + typeIconSvg(s.id, 22) + '</span>' +
      (featured ? ('<span class="bda-tile-pill">' + esc(t('recommendedFoundation')) + '</span>') : '') +
      '</span>' +
      '<span class="bda-tile-label">' + esc(skillText(s.id, 'name')) + '</span>' +
      '<span class="bda-tile-about">' + esc(skillText(s.id, 'about')) + '</span>' +
      '</button>' +
      '</li>';
  }).join('');
}

function renderMissingTray() {
  const tray = document.getElementById('missingTray');
  if (!tray) return;
  const missing = missingArtifacts();
  if (!missing.length) {
    tray.className = 'missing-tray hidden';
    tray.innerHTML = '';
    return;
  }
  tray.className = 'missing-tray';
  tray.innerHTML =
    '<div class="missing-bar">' +
    '<div class="missing-bar-copy">' +
    '<div class="missing-bar-title"><span class="bda-missing-badge">' + esc(t('missing')) + ' · ' + missing.length + '</span>' +
    '<span>' + esc(t('missingBannerTitle', { count: missing.length })) + '</span></div>' +
    '<div class="missing-bar-desc">' + esc(t('missingBannerDesc')) + '</div>' +
    '</div>' +
    '<div class="missing-bar-actions">' +
    '<button type="button" class="bda-btn" id="toggleMissingDetailsBtn">' + esc(state.showMissingDetails ? t('missingHide') : t('missingShow')) + '</button>' +
    '<button type="button" class="bda-btn" data-danger="true" id="clearAllMissingBtn">' + esc(t('missingClearAll', { count: missing.length })) + '</button>' +
    '</div>' +
    '</div>' +
    (state.showMissingDetails
      ? '<ul class="missing-list">' + missing.map((it) => {
          const reason = it.missingReason === 'marker_missing' ? t('missingReasonMarker') : t('missingReasonDir');
          return '<li class="bda-item bda-missing" data-root="' + esc(it.root) + '">' +
            '<div class="missing-item-main">' +
            '<span class="bda-glyph" style="--bda-tint:' + (TINTS[it.skill] || '#888') + '">' + typeIconSvg(it.skill, 16) + '</span>' +
            '<div style="min-width:0">' +
            '<div style="display:flex;align-items:center;gap:8px"><strong style="font-size:13px">' + esc(it.title) + '</strong><span style="font-size:11px;color:var(--dsw-alias-label-tertiary)">' + esc(reason) + '</span></div>' +
            '<div class="missing-item-path" title="' + esc(it.root) + '">' + esc(it.root) + '</div>' +
            '</div>' +
            '</div>' +
            '<button type="button" class="bda-btn" data-forget-root="' + esc(it.root) + '">' + esc(t('forget')) + '</button>' +
            '</li>';
        }).join('') + '</ul>'
      : '');

  document.getElementById('toggleMissingDetailsBtn').onclick = () => {
    state.showMissingDetails = !state.showMissingDetails;
    renderMissingTray();
  };
  document.getElementById('clearAllMissingBtn').onclick = async () => {
    const res = await api('/api/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ allMissing: true }),
    });
    if (res.ok) {
      state.showMissingDetails = false;
      showToast(t('missingClearedAll', { count: res.removed ?? missing.length }));
      await reload();
    } else {
      showToast(t('forgetFailed') + (res.error || ''));
    }
  };
  tray.querySelectorAll('[data-forget-root]').forEach((btn) => {
    btn.onclick = async () => {
      const root = btn.getAttribute('data-forget-root');
      const res = await api('/api/forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root }),
      });
      showToast(res.ok ? t('forgotten') : t('forgetFailed') + (res.error || ''));
      if (res.ok) await reload();
    };
  });
}

function syncSectionOrder() {
  const wsItems = workspaceArtifacts();
  const hasActiveWorks = wsItems.length > 0 || (state.scope === 'all' && validArtifacts().length > 0);
  const desired = hasActiveWorks
    ? ['sec-ds', 'sec-works', 'sec-examples', 'sec-new', 'sec-workflows']
    : ['sec-ds', 'sec-examples', 'sec-works', 'sec-new', 'sec-workflows'];

  // 使用 CSS order 重排而非 DOM appendChild，避免浏览器销毁并重置示例卡片中的 srcdoc iframe
  desired.forEach((id, idx) => {
    const order = String(idx + 1);
    const sec = document.getElementById(id);
    if (sec && sec.style.order !== order) sec.style.order = order;
    const btn = document.querySelector('#railNav [data-nav="' + id + '"]');
    if (btn && btn.style.order !== order) btn.style.order = order;
  });
}

function renderScopeSwitch() {
  const wrap = document.getElementById('scopeSwitch');
  if (!wrap) return;
  const allCount = validArtifacts().length;
  const wsCount = workspaceArtifacts().length;
  if (!state.workspaceRoot || allCount === 0) {
    wrap.className = 'scope-switch hidden';
    wrap.innerHTML = '';
    return;
  }
  wrap.className = 'scope-switch';
  wrap.innerHTML =
    '<button type="button" class="scope-btn" data-scope="workspace" data-on="' + (state.scope === 'workspace') + '">' +
    esc(t('scopeWorkspace', { count: wsCount })) + '</button>' +
    '<button type="button" class="scope-btn" data-scope="all" data-on="' + (state.scope === 'all') + '">' +
    esc(t('scopeAll', { count: allCount })) + '</button>';
  wrap.onclick = (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    state.scope = btn.getAttribute('data-scope');
    renderItems();
  };
}

function renderItems() {
  syncSectionOrder();
  renderRailSkills();
  renderDesignSystemStage();
  renderMissingTray();
  renderScopeSwitch();

  const container = document.getElementById('container');
  const items = getSortedList();
  const isGrid = state.viewMode === 'grid';
  document.getElementById('viewModeIcon').innerHTML = isGrid ? SVG_ICONS.list : SVG_ICONS.grid;
  document.getElementById('viewModeBtn').title = isGrid ? t('listView') : t('gridView');
  document.getElementById('filterBtn').setAttribute('data-active', isFilterActive() ? 'true' : 'false');
  document.getElementById('listHeading').textContent = t('allWorksCount', { count: items.length });

  if (!items.length) {
    const filtered = Boolean(state.search || isFilterActive());
    if (filtered) {
      container.innerHTML = '<div class="bda-empty">' +
        SVG_ICONS.info +
        '<h2>' + esc(t('noMatches')) + '</h2>' +
        '<p>' + esc(t('clearHint')) + '</p>' +
        '<button type="button" class="bda-btn" id="clearFilterBtn" style="margin-top:10px">' + esc(t('clearFilters')) + '</button>' +
        '</div>';
      const clearBtn = document.getElementById('clearFilterBtn');
      if (clearBtn) {
        clearBtn.onclick = () => {
          state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false };
          state.search = '';
          document.getElementById('q').value = '';
          document.getElementById('clearSearch').className = 'hidden';
          renderItems();
        };
      }
      return;
    }

    const otherCount = Math.max(0, validArtifacts().length - workspaceArtifacts().length);
    container.innerHTML = '<div class="bda-empty-compact">' +
      '<div class="bda-empty-compact-copy">' + SVG_ICONS.info + '<span>' + esc(t('emptyCompactText')) + '</span></div>' +
      '<div class="bda-empty-compact-actions">' +
      (otherCount > 0 && state.scope === 'workspace'
        ? ('<button type="button" class="bda-btn" id="emptyShowAllBtn">' + esc(t('emptyShowOtherWs', { count: otherCount })) + '</button>')
        : '') +
      '<button type="button" class="bda-btn" data-primary="true" id="emptyInitDsBtn">' + esc(t('dsInitBtn')) + '</button>' +
      '</div></div>';
    const showAllBtn = document.getElementById('emptyShowAllBtn');
    if (showAllBtn) {
      showAllBtn.onclick = () => {
        state.scope = 'all';
        renderItems();
      };
    }
    const initBtn = document.getElementById('emptyInitDsBtn');
    if (initBtn) initBtn.onclick = () => instantiateTemplate('claude-design-system', true);
    return;
  }

  if (isGrid) {
    container.innerHTML = '<ul class="bda-grid">' + items.map((it) => {
      const isOpening = state.openingRoot === it.root;
      const scopeLabel = state.workspaceRoot ? (it.inCurrentWorkspace ? t('currentWsBadge') : t('otherWsBadge')) : '';
      return '<li class="bda-item" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" data-pinned="' + Boolean(it.pinned) + '" style="--bda-tint:' + (TINTS[it.skill] || '#007fa8') + '">' +
        '<button type="button" class="bda-card" data-act="open" ' + (isOpening ? 'disabled' : '') + '>' +
        '<span class="bda-preview">' +
        '<span class="bda-sheet">' + drawnHtml(it.skill, it.title) + '</span>' +
        (it.preview ? '<iframe class="bda-live" data-src="/api/preview?skill=' + encodeURIComponent(it.skill) + '&root=' + encodeURIComponent(it.root) + '" tabindex="-1" sandbox="allow-scripts" title="' + esc(t('projectPreview')) + '"></iframe>' : '') +
        (it.thumb ? '<img class="bda-thumb" src="/api/thumb?root=' + encodeURIComponent(it.root) + '" alt="" onerror="this.remove()">' : '') +
        (scopeLabel ? '<span class="bda-scope-tag" data-current="' + Boolean(it.inCurrentWorkspace) + '">' + esc(scopeLabel) + '</span>' : '') +
        (isOpening ? ('<span class="bda-busy"><span class="bda-spinner"></span>' + esc(t('opening')) + '</span>') : '') +
        '</span>' +
        '<span class="bda-info">' +
        '<span class="bda-glyph">' + typeIconSvg(it.skill, 18) + '</span>' +
        '<span class="bda-text">' +
        '<span class="bda-name" title="' + esc(it.title) + '">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + esc(ago(it.openedAt)) + (it.note ? ' · ' + esc(it.note) : '') + '</span>' +
        '</span>' +
        '</span>' +
        '</button>' +
        '<div class="bda-actions">' +
        '<button type="button" class="bda-act" data-act="more" title="' + esc(t('more')) + '">' + SVG_ICONS.more + '</button>' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + Boolean(it.pinned) + '" title="' + esc(it.pinned ? t('unpin') : t('pin')) + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) +
        '</button>' +
        '</div>' +
        '</li>';
    }).join('') + '</ul>';
  } else {
    container.innerHTML = '<ul class="bda-list">' + items.map((it) => {
      const isOpening = state.openingRoot === it.root;
      return '<li class="bda-item" data-root="' + esc(it.root) + '" data-skill="' + esc(it.skill) + '" style="--bda-tint:' + (TINTS[it.skill] || '#007fa8') + '">' +
        '<button type="button" class="bda-row" data-act="open" ' + (isOpening ? 'disabled' : '') + '>' +
        '<span class="bda-glyph">' + (isOpening ? '<span class="bda-spinner"></span>' : typeIconSvg(it.skill, 18)) + '</span>' +
        '<span class="bda-name">' + esc(it.title) + '</span>' +
        '<span class="bda-meta">' + esc(localizedMeta(it) ? localizedMeta(it) + ' · ' : '') + esc(ago(it.openedAt)) + (it.note ? ' · ' + esc(it.note) : '') + '</span>' +
        '</button>' +
        '<div class="bda-row-tools">' +
        '<button type="button" class="bda-act" data-act="pin" data-on="' + Boolean(it.pinned) + '" title="' + esc(it.pinned ? t('unpin') : t('pin')) + '">' +
        (it.pinned ? SVG_ICONS.pinFilled : SVG_ICONS.pin) +
        '</button>' +
        '<button type="button" class="bda-act" data-act="more" title="' + esc(t('more')) + '">' + SVG_ICONS.more + '</button>' +
        '</div>' +
        '</li>';
    }).join('') + '</ul>';
  }
  activateLivePreviews(container);
}

function rescaleStageFrames() {
  document.querySelectorAll('[data-stage-example]').forEach((stage) => {
    const f = stage.querySelector('iframe');
    if (!f) return;
    const w = stage.clientWidth || 320;
    f.style.transform = 'scale(' + (w / 1200) + ')';
  });
  document.querySelectorAll('.bda-live.on').forEach((f) => {
    const w = (f.parentElement && f.parentElement.clientWidth) || 320;
    f.style.transform = 'scale(' + (w / 1280) + ')';
  });
}

const stageResizeObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(() => rescaleStageFrames())
  : null;
window.addEventListener('resize', rescaleStageFrames, { passive: true });

function activateLivePreviews(container) {
  const scrollRoot = document.getElementById('mainScroll');
  const mount = (f) => {
    if (f.dataset.mounted === '1') return;
    f.dataset.mounted = '1';
    const w = (f.parentElement && f.parentElement.clientWidth) || 320;
    f.style.transform = 'scale(' + (w / 1280) + ')';
    f.addEventListener('load', () => f.classList.add('on'), { once: true });
    f.src = f.getAttribute('data-src');
    setTimeout(() => f.classList.add('on'), 600);
    if (stageResizeObserver && f.parentElement) stageResizeObserver.observe(f.parentElement);
  };
  if (typeof IntersectionObserver === 'undefined') {
    container.querySelectorAll('.bda-live[data-src]').forEach(mount);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      mount(e.target);
    }
  }, { root: scrollRoot, rootMargin: '260px' });
  container.querySelectorAll('.bda-live[data-src]').forEach((f) => io.observe(f));
}

function activateExampleStages(container) {
  container.querySelectorAll('[data-stage-example]').forEach((stage) => {
    const exId = stage.getAttribute('data-stage-example');
    const ex = OFFICIAL_EXAMPLES.find((x) => x.id === exId);
    if (!ex || !ex.html) return;
    const f = stage.querySelector('iframe');
    if (!f) return;
    const w = stage.clientWidth || 320;
    f.style.transform = 'scale(' + (w / 1200) + ')';
    f.srcdoc = ex.html;
    if (stageResizeObserver) stageResizeObserver.observe(stage);
  });
}

async function openItem(item) {
  state.openingRoot = item.root;
  renderItems();
  try {
    const res = await api('/api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skill: item.skill, root: item.root }),
    });
    if (!res.ok) {
      showToast(t('cannotOpen') + (res.error || t('unknownError')));
      return;
    }
    const frame = document.getElementById('frame');
    document.getElementById('editorTitle').textContent = item.title + ' · ' + skillText(item.skill, 'name');
    frame.src = res.url;
    document.getElementById('popBtn').onclick = () => window.open(res.url, '_blank');
    document.getElementById('listView').classList.add('hidden');
    document.getElementById('editorView').classList.remove('hidden');
    history.pushState({ editor: true }, '', '#editor');
  } catch (err) {
    showToast(t('openFailed') + err.message);
  } finally {
    state.openingRoot = null;
    renderItems();
  }
}

function backToGallery() {
  document.getElementById('editorView').classList.add('hidden');
  document.getElementById('listView').classList.remove('hidden');
  document.getElementById('frame').src = 'about:blank';
  if (location.hash) history.replaceState({}, '', location.pathname + location.search);
  reload();
}
window.addEventListener('popstate', () => {
  if (!document.getElementById('editorView').classList.contains('hidden')) backToGallery();
});
document.getElementById('backBtn').onclick = backToGallery;

function showActionsMenu(item, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  anchorEl.closest('.bda-item')?.setAttribute('data-menu', 'true');
  layer.innerHTML = '<div class="bda-menu" style="left:' + Math.min(rect.left, window.innerWidth - 230) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<button type="button" class="bda-menu-item" data-menu-action="pin">' +
    SVG_ICONS.pin + '<span class="bda-menu-label">' + esc(item.pinned ? t('unpin') : t('pin')) + '</span><kbd class="bda-menu-key">P</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="rename">' +
    SVG_ICONS.rename + '<span class="bda-menu-label">' + esc(t('rename')) + '</span><kbd class="bda-menu-key">R</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="recreate">' +
    SVG_ICONS.spark + '<span class="bda-menu-label">' + esc(t('recreate')) + '</span><kbd class="bda-menu-key">S</kbd>' +
    '</button>' +
    '<button type="button" class="bda-menu-item" data-menu-action="copy">' +
    SVG_ICONS.copy + '<span class="bda-menu-label">' + esc(t('copyLink')) + '</span><kbd class="bda-menu-key">C</kbd>' +
    '</button>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-menu-action="delete" data-danger="true">' +
    SVG_ICONS.trash + '<span class="bda-menu-label">' + esc(t('delete')) + '</span><kbd class="bda-menu-key">Del</kbd>' +
    '</button>' +
    '</div>';

  const menu = layer.querySelector('.bda-menu');
  menu.onclick = async (e) => {
    const btn = e.target.closest('[data-menu-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-menu-action');
    closeMenu();
    if (act === 'pin') {
      await api('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) });
      await reload();
    } else if (act === 'rename') {
      openRenameDialog(item);
    } else if (act === 'recreate') {
      const res = await api('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: item.root }) });
      if (res.ok) showToast(t('remixSent', { outcome: res.outcome || 'chat' }));
      else {
        try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); }
        catch { showToast(t('remixFailed') + (res.error || '')); }
      }
    } else if (act === 'copy') {
      const res = await api('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skill: item.skill, root: item.root }) });
      if (res.ok && res.url) {
        await navigator.clipboard.writeText(res.url);
        showToast(t('linkCopied'));
      } else {
        showToast(t('linkFailed'));
      }
    } else if (act === 'delete') {
      openDeleteDialog(item);
    }
  };
}

function openRenameDialog(item) {
  openDialog(
    '<h2>' + esc(t('renameTitle')) + '</h2>' +
    '<p>' + esc(t('renameDescription', { title: item.title })) + '</p>' +
    '<input id="renameInput" value="' + esc(item.title) + '" maxlength="200" autofocus>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="renameCancel">' + esc(t('cancel')) + '</button>' +
    '<button type="button" class="bda-btn" data-primary="true" id="renameSave">' + esc(t('save')) + '</button>' +
    '</div>'
  );
  const input = document.getElementById('renameInput');
  input.focus();
  input.select();
  document.getElementById('renameCancel').onclick = closeDialog;
  document.getElementById('renameSave').onclick = async () => {
    const val = input.value.trim();
    if (!val || val === item.title) return closeDialog();
    closeDialog();
    const res = await api('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: item.root, title: val, skill: item.skill }) });
    if (res.ok) {
      showToast(t('renamed', { title: val }));
      await reload();
    } else {
      showToast(t('renameFailed') + (res.error || ''));
    }
  };
}

function openDeleteDialog(item) {
  const desc = item.deletable ? t('deleteMove') : t('deleteKeep') + item.root;
  openDialog(
    '<h2>' + esc(t('deleteTitle', { title: item.title })) + '</h2>' +
    '<p>' + esc(desc) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="deleteCancel">' + esc(t('cancel')) + '</button>' +
    '<button type="button" class="bda-btn" data-danger="true" id="deleteConfirm">' + esc(t('delete')) + '</button>' +
    '</div>'
  );
  document.getElementById('deleteCancel').onclick = closeDialog;
  document.getElementById('deleteConfirm').onclick = async () => {
    closeDialog();
    const res = await api('/api/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: item.root }) });
    if (res.ok) {
      showToast(item.deletable ? t('deleted', { title: item.title }) : t('removed', { title: item.title }), res.trash);
      await reload();
    } else {
      showToast(t('deleteFailed') + (res.error || ''));
    }
  };
}

function openCreateDialog(skillId) {
  const s = SKILL_MAP[skillId];
  if (!s) return;
  const canScaffold = Boolean(EXAMPLE_TEMPLATES[skillId]);
  openDialog(
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;color:' + (TINTS[s.id] || 'inherit') + '">' +
    typeIconSvg(s.id, 26) +
    '<h2 style="margin:0;color:var(--dsw-alias-label-primary)">' + esc(t('createTitle', { title: skillText(s.id, 'name') })) + '</h2>' +
    '</div>' +
    '<p>' + esc(skillText(s.id, 'about')) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="createCancel">' + esc(t('cancel')) + '</button>' +
    '<button type="button" class="bda-btn" id="copyPromptBtn">' + esc(t('copyPrompt')) + '</button>' +
    (canScaffold ? ('<button type="button" class="bda-btn" data-primary="true" id="createScaffoldBtn">' + esc(t('createBlank')) + '</button>') : '') +
    '</div>'
  );
  document.getElementById('createCancel').onclick = closeDialog;
  document.getElementById('copyPromptBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(skillText(s.id, 'prompt'));
      closeDialog();
      showToast(t('promptCopied'));
    } catch {
      showToast(t('copyFailed') + skillText(s.id, 'prompt'));
    }
  };
  if (canScaffold) {
    document.getElementById('createScaffoldBtn').onclick = async () => {
      closeDialog();
      await instantiateTemplate(skillId, true);
    };
  }
}

function showFilterMenu(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const layer = document.getElementById('menuLayer');
  const typeCounts = new Map();
  validArtifacts().forEach((a) => typeCounts.set(a.skill, (typeCounts.get(a.skill) || 0) + 1));
  const sortLabels = { opened: t('sortOpened'), updated: t('sortUpdated'), created: t('sortCreated'), name: t('sortName') };
  const dateLabels = { any: t('any'), today: t('today'), yesterday: t('yesterday'), week: t('week'), month: t('month') };
  const shareLabels = { any: t('any'), shared: t('shared'), private: t('private') };

  layer.innerHTML = '<div class="bda-menu" style="right:' + (window.innerWidth - rect.right) + 'px;top:' + (rect.bottom + 6) + 'px">' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">' + esc(t('sortBy')) + '</span><span class="bda-menu-value">' + esc(sortLabels[state.filters.sort]) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(sortLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-sort="' + k + '"><span class="bda-menu-label">' + esc(v) + '</span>' +
      (state.filters.sort === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">' + esc(t('type')) + '</span><span class="bda-menu-value">' + esc(state.filters.types.length ? state.filters.types.length + t('selectedSuffix') : t('any')) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    SKILLS_CONFIG.map((s) => {
      const on = state.filters.types.includes(s.id);
      return '<button type="button" class="bda-menu-item" data-toggle-type="' + s.id + '">' +
        '<span class="bda-check" data-on="' + on + '">' + (on ? SVG_ICONS.tick : '') + '</span>' +
        '<span class="bda-menu-label">' + esc(skillText(s.id, 'name')) + '</span>' +
        '<span class="bda-menu-count">' + (typeCounts.get(s.id) || 0) + '</span></button>';
    }).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">' + esc(t('openedAt')) + '</span><span class="bda-menu-value">' + esc(dateLabels[state.filters.date]) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(dateLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-date="' + k + '"><span class="bda-menu-label">' + esc(v) + '</span>' +
      (state.filters.date === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-row">' +
    '<button type="button" class="bda-menu-item">' +
    '<span class="bda-menu-label">' + esc(t('sharing')) + '</span><span class="bda-menu-value">' + esc(shareLabels[state.filters.sharing]) + '</span><span class="bda-menu-chev">' + SVG_ICONS.chevron + '</span>' +
    '</button>' +
    '<div class="bda-submenu">' +
    Object.entries(shareLabels).map(([k, v]) =>
      '<button type="button" class="bda-menu-item" data-set-share="' + k + '"><span class="bda-menu-label">' + esc(v) + '</span>' +
      (state.filters.sharing === k ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') + '</button>'
    ).join('') +
    '</div></div>' +
    '<div class="bda-menu-rule"></div>' +
    '<button type="button" class="bda-menu-item" data-toggle-pinned="true">' +
    '<span class="bda-menu-label">' + esc(t('pinned')) + '</span>' + (state.filters.pinned ? '<span class="bda-tick">' + SVG_ICONS.tick + '</span>' : '') +
    '</button>' +
    (isFilterActive() ? ('<button type="button" class="bda-menu-item" data-clear-filters="true"><span class="bda-menu-label">' + esc(t('clearFilters')) + '</span></button>') : '') +
    '</div>';

  const menu = layer.querySelector('.bda-menu');
  menu.onclick = (e) => {
    const tSort = e.target.closest('[data-set-sort]');
    if (tSort) { state.filters.sort = tSort.getAttribute('data-set-sort'); closeMenu(); renderItems(); return; }
    const tType = e.target.closest('[data-toggle-type]');
    if (tType) {
      const sk = tType.getAttribute('data-toggle-type');
      if (state.filters.types.includes(sk)) state.filters.types = state.filters.types.filter((x) => x !== sk);
      else state.filters.types.push(sk);
      closeMenu(); renderItems(); return;
    }
    const tDate = e.target.closest('[data-set-date]');
    if (tDate) { state.filters.date = tDate.getAttribute('data-set-date'); closeMenu(); renderItems(); return; }
    const tShare = e.target.closest('[data-set-share]');
    if (tShare) { state.filters.sharing = tShare.getAttribute('data-set-share'); closeMenu(); renderItems(); return; }
    if (e.target.closest('[data-toggle-pinned]')) { state.filters.pinned = !state.filters.pinned; closeMenu(); renderItems(); return; }
    if (e.target.closest('[data-clear-filters]')) {
      state.filters = { sort: 'opened', types: [], date: 'any', sharing: 'any', pinned: false };
      closeMenu(); renderItems();
    }
  };
}

function openExamplePreviewModal(example) {
  if (example.id === 'claude-design-system') {
    openDsInspectorDialog('Cover');
    return;
  }
  openDialog(
    '<h2>' + esc(exampleText(example, 'title')) + '</h2>' +
    '<p>' + esc(exampleText(example, 'desc')) + '</p>' +
    (example.html
      ? '<div class="bda-example-preview" id="examplePreview"><iframe sandbox="" title="' + esc(t('previewTitle', { title: exampleText(example, 'title') })) + '"></iframe></div>'
      : '<div class="bda-example-skeleton">' + drawnHtml(example.skill, exampleText(example, 'title')) + '<p>' + esc(t('exampleSkeleton')) + '</p></div>') +
    '<p>' + esc(exampleText(example, 'points')) + '</p>' +
    '<div class="bda-dialog-actions">' +
    '<button type="button" class="bda-btn" id="exampleClose">' + esc(t('close')) + '</button>' +
    '<button type="button" class="bda-btn" data-primary="true" id="exampleInstantiateBtn">' + esc(t('useTemplate')) + '</button>' +
    '</div>',
    true
  );
  document.getElementById('exampleClose').onclick = closeDialog;
  document.getElementById('exampleInstantiateBtn').onclick = async () => {
    closeDialog();
    await instantiateTemplate(example.id, true);
  };
  if (example.html) {
    const preview = document.getElementById('examplePreview');
    const frame = preview.querySelector('iframe');
    const scale = Math.min(1, (preview.clientWidth || 860) / 1200);
    preview.style.height = Math.round(750 * scale) + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    frame.srcdoc = example.html;
  }
}

function renderExamples() {
  const ul = document.getElementById('examples');
  ul.innerHTML = OFFICIAL_EXAMPLES.map((example) =>
    '<li class="bda-example">' +
    '<div class="bda-example-stage" data-stage-example="' + esc(example.id) + '" data-act="preview" data-example="' + esc(example.id) + '">' +
    (example.label ? '<span class="bda-example-label">' + esc(example.label) + '</span>' : '') +
    '<iframe sandbox="" tabindex="-1" title="' + esc(exampleText(example, 'title')) + '"></iframe>' +
    '</div>' +
    '<div class="bda-example-body">' +
    '<span class="bda-example-skill">' + typeIconSvg(example.skill, 15) + esc(skillText(example.skill, 'name')) + '</span>' +
    '<h3>' + esc(exampleText(example, 'title')) + '</h3>' +
    '<p>' + esc(exampleText(example, 'desc')) + '</p>' +
    '<div class="bda-example-actions">' +
    '<button type="button" class="bda-btn" data-primary="true" data-act="instantiate" data-example="' + esc(example.id) + '">' + esc(t('useTemplate')) + '</button>' +
    '<button type="button" class="bda-btn" data-act="preview" data-example="' + esc(example.id) + '">' + esc(t('preview')) + '</button>' +
    '<button type="button" class="bda-btn" data-act="start" data-example="' + esc(example.id) + '">' + esc(t('recreate')) + '</button>' +
    '</div>' +
    '</div>' +
    '</li>'
  ).join('');
  activateExampleStages(ul);
}

function renderRecipes() {
  const ul = document.getElementById('recipes');
  ul.innerHTML = RECIPES.map((r, idx) =>
    '<li><button type="button" class="recipe-card" data-recipe="' + esc(r.id) + '">' +
    '<div><div class="recipe-step">WORKFLOW 0' + (idx + 1) + '</div>' +
    '<div class="recipe-title">' + esc(t('recipe.' + r.id + '.title')) + '</div>' +
    '<div class="bda-recipe-desc">' + esc(t('recipe.' + r.id + '.desc')) + '</div></div>' +
    '<div class="recipe-foot">' + esc(t('runWorkflow')) + '</div>' +
    '</button></li>'
  ).join('');
}

function updateWorkspaceBadge() {
  const el = document.getElementById('wsLabel');
  if (!el) return;
  el.textContent = state.workspaceName ? state.workspaceName : t('railNoWorkspace');
  el.title = state.workspaceRoot || '';
}

function renderAll() {
  document.documentElement.lang = locale();
  document.title = t('works') + ' · Lakala-Design-Plugin';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  updateWorkspaceBadge();
  document.getElementById('languageBtn').textContent = t('languageButton');
  renderSchemeButton();
  renderTiles();
  renderExamples();
  renderRecipes();
  renderItems();
  document.documentElement.removeAttribute('data-i18n-pending');
}

document.getElementById('dsPrimaryBtn').onclick = triggerPrimaryDesignSystemAction;
document.getElementById('dsInspectBtn').onclick = () => openDsInspectorDialog('Cover');
document.getElementById('dsAgentBtn').onclick = async () => {
  const activeDs = activeWorkspaceDesignSystem();
  const payload = activeDs && activeDs.inCurrentWorkspace ? { root: activeDs.root } : { example: 'claude-design-system' };
  const res = await api('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.ok) showToast(t('exampleStarted'));
  else if (res.starter) {
    try { await navigator.clipboard.writeText(res.starter); showToast(t('draftCopied') + (res.error || '')); }
    catch { showToast(t('startFailed') + (res.error || '')); }
  } else {
    showToast(t('startFailed') + (res.error || t('unknownError')));
  }
};

document.querySelector('.ds-lab-bar').onclick = (e) => {
  const tabBtn = e.target.closest('[data-ds-tab]');
  if (tabBtn) {
    state.dsTab = tabBtn.getAttribute('data-ds-tab');
    renderDesignSystemStage();
    return;
  }
  const themeBtn = e.target.closest('[data-ds-theme]');
  if (themeBtn) {
    state.dsTheme = themeBtn.getAttribute('data-ds-theme');
    renderDesignSystemStage();
  }
};

document.getElementById('dsLabBody').onclick = async (e) => {
  const swatch = e.target.closest('[data-copy-token]');
  if (!swatch) return;
  const token = '--' + swatch.getAttribute('data-copy-token');
  const hex = swatch.getAttribute('data-copy-hex');
  try {
    await navigator.clipboard.writeText('var(' + token + ', ' + hex + ')');
    showToast(t('dsTokenCopied', { token, hex: hex.toUpperCase() }));
  } catch {
    showToast(token + ': ' + hex);
  }
};

document.querySelector('.bda-rail').onclick = (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    const targetId = navBtn.getAttribute('data-nav');
    const sec = document.getElementById(targetId);
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('[data-nav]').forEach((b) => b.setAttribute('data-active', b === navBtn ? 'true' : 'false'));
    return;
  }
  const skBtn = e.target.closest('[data-skill-filter]');
  if (skBtn) {
    const sk = skBtn.getAttribute('data-skill-filter');
    if (!sk || (state.filters.types.length === 1 && state.filters.types[0] === sk)) {
      state.filters.types = [];
    } else {
      state.filters.types = [sk];
    }
    renderItems();
    const worksSec = document.getElementById('sec-works');
    if (worksSec) worksSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

document.getElementById('typePills').onclick = (e) => {
  const btn = e.target.closest('[data-skill-pill]');
  if (!btn) return;
  const sk = btn.getAttribute('data-skill-pill');
  if (!sk) state.filters.types = [];
  else if (state.filters.types.length === 1 && state.filters.types[0] === sk) state.filters.types = [];
  else state.filters.types = [sk];
  renderItems();
};

document.getElementById('tiles').onclick = (e) => {
  const btn = e.target.closest('.bda-tile');
  if (btn && btn.getAttribute('data-skill')) openCreateDialog(btn.getAttribute('data-skill'));
};

document.getElementById('examples').onclick = async (e) => {
  const target = e.target.closest('[data-act][data-example]');
  if (!target) return;
  const example = OFFICIAL_EXAMPLES.find((x) => x.id === target.getAttribute('data-example'));
  if (!example) return;
  const act = target.getAttribute('data-act');
  if (act === 'preview') {
    openExamplePreviewModal(example);
    return;
  }
  if (act === 'instantiate') {
    target.disabled = true;
    try { await instantiateTemplate(example.id, true); }
    finally { target.disabled = false; }
    return;
  }
  if (act === 'start') {
    target.disabled = true;
    try {
      const res = await api('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ example: example.id }) });
      if (res.ok) showToast(t('exampleStarted'));
      else if (res.starter) {
        try { await navigator.clipboard.writeText(res.starter); showToast(t('draftCopied') + (res.error || '')); }
        catch { showToast(t('startFailed') + (res.error || '') + t('draftPrefix') + res.starter); }
      } else showToast(t('startFailed') + (res.error || t('unknownError')));
    } catch (err) {
      showToast(t('startFailed') + err.message);
    } finally {
      target.disabled = false;
    }
  }
};

document.getElementById('recipes').onclick = async (e) => {
  const btn = e.target.closest('[data-recipe]');
  if (!btn) return;
  const res = await api('/api/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipe: btn.getAttribute('data-recipe') }) });
  if (res.ok) showToast(t('workflowSent', { outcome: res.outcome || 'chat' }));
  else {
    try { await navigator.clipboard.writeText(res.starter || ''); showToast(t('draftCopied') + (res.error || '')); }
    catch { showToast(t('workflowFailed') + (res.error || '')); }
  }
};

document.getElementById('container').onclick = async (e) => {
  const itemEl = e.target.closest('.bda-item');
  if (!itemEl) return;
  const root = itemEl.getAttribute('data-root');
  const item = state.artifacts.find((a) => a.root === root);
  if (!item) return;

  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  if (act === 'open') await openItem(item);
  else if (act === 'pin') {
    await api('/api/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: item.root, pinned: !item.pinned }) });
    await reload();
  } else if (act === 'more') {
    showActionsMenu(item, btn);
  }
};

const qInput = document.getElementById('q');
const clearSearchBtn = document.getElementById('clearSearch');
qInput.oninput = () => {
  state.search = qInput.value;
  clearSearchBtn.className = state.search ? '' : 'hidden';
  renderItems();
};
clearSearchBtn.onclick = () => {
  qInput.value = '';
  state.search = '';
  clearSearchBtn.className = 'hidden';
  qInput.focus();
  renderItems();
};
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== qInput && !document.querySelector('.bda-scrim:not(.hidden)')) {
    e.preventDefault();
    qInput.focus();
  } else if (e.key === 'Escape') {
    if (!document.getElementById('dialogScrim').classList.contains('hidden')) closeDialog();
    else if (document.getElementById('menuLayer').innerHTML) closeMenu();
    else if (qInput.value) clearSearchBtn.click();
  }
});

document.getElementById('viewModeBtn').onclick = () => {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  writePreference('ps_view_mode', state.viewMode);
  renderItems();
};
document.getElementById('filterBtn').onclick = (e) => showFilterMenu(e.currentTarget);

document.getElementById('schemeBtn').onclick = () => {
  const next = currentEffectiveScheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.scheme = next;
  writePreference('ps-scheme', next);
  writePreference('ps-scheme-manual', '1');
  state.dsTheme = next;
  renderSchemeButton();
  renderDesignSystemStage();
};

document.getElementById('languageBtn').onclick = () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  writePreference('ps_lang', lang);
  const url = new URL(location.href);
  url.searchParams.set('lang', lang);
  history.replaceState(history.state, '', url);
  closeMenu();
  closeDialog();
  document.getElementById('toast').className = 'hidden';
  renderAll();
};

document.getElementById('reloadBtn').onclick = async () => {
  await reload();
  showToast(t('refreshed'));
};

const mainScroll = document.getElementById('mainScroll');
mainScroll.addEventListener('scroll', () => {
  const secs = [...document.querySelectorAll('.bda-content > section[id]')]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  let active = secs[0] ? secs[0].id : 'sec-ds';
  for (const el of secs) {
    if (el.getBoundingClientRect().top <= 160) active = el.id;
  }
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.setAttribute('data-active', b.getAttribute('data-nav') === active ? 'true' : 'false');
  });
}, { passive: true });

async function reload() {
  try {
    const res = await api('/api/list');
    if (res.ok) {
      state.artifacts = res.artifacts || [];
      state.workspaceName = res.workspaceName || '';
      state.workspaceRoot = res.workspaceRoot || '';
      updateWorkspaceBadge();
      renderItems();
    }
  } catch (err) {
    showToast(t('loadFailed') + err.message);
  }
}

renderAll();
reload();
`;

export function buildGalleryHtml({
  requestedLang = 'zh',
  requestedScheme = '',
  resolvedHostScheme = '',
  skills,
  tints,
  recipes,
  examples,
  templatesMap,
  lakalaTokens,
  dsComponents,
}) {
  const initialLang = requestedLang === 'en' ? 'en' : 'zh';
  const hostSchemeValue = requestedScheme === 'dark' || requestedScheme === 'light'
    ? requestedScheme
    : resolvedHostScheme;
  const galleryStr = createGalleryStrings(skills, recipes, examples);
  const text = (key) => escHtml(galleryStr[initialLang][key] ?? galleryStr.zh[key] ?? key);

  return `<!doctype html>
<html data-i18n-pending lang="${initialLang === 'en' ? 'en' : 'zh-CN'}" data-initial-lang="${initialLang}"${hostSchemeValue ? ` data-host-scheme="${hostSchemeValue}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text('works')} · Lakala-Design-Plugin</title>
<script>
try {
  const requested = new URLSearchParams(location.search).get('lang');
  const saved = localStorage.getItem('ps_lang');
  const selected = ['zh', 'en'].includes(requested) ? requested : ['zh', 'en'].includes(saved) ? saved : 'zh';
  document.documentElement.lang = selected === 'en' ? 'en' : 'zh-CN';
} catch {}
</script>
<style>${GALLERY_CSS}</style>
</head>
<body>

<div class="bda-page" id="listView">
  <aside class="bda-rail">
    <div class="rail-brand">
      <span class="rail-mark" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="9.5" cy="10" r="6.2"/>
          <circle cx="13.5" cy="6.5" r="2.2" fill="#00b9f1" stroke="none"/>
        </svg>
      </span>
      <span class="rail-brand-text">
        <span class="rail-brand-name">Lakala-Design-Plugin</span>
        <span class="rail-brand-tag">Design Studio</span>
      </span>
    </div>

    <div class="rail-ws-card">
      <div class="rail-ws-eyebrow" data-i18n="railWorkspaceLabel">${text('railWorkspaceLabel')}</div>
      <div class="rail-ws-row">
        <span class="rail-ws-dot" aria-hidden="true"></span>
        <span class="bda-ws" id="wsLabel">${text('railNoWorkspace')}</span>
      </div>
    </div>

    <nav class="rail-group rail-nav" id="railNav" aria-label="Sections">
      <button type="button" class="rail-link" data-nav="sec-ds" data-active="true">
        <span data-i18n="navDesignSystem">${text('navDesignSystem')}</span>
        <span class="rail-badge">Lakala</span>
      </button>
      <button type="button" class="rail-link" data-nav="sec-examples" data-active="false">
        <span data-i18n="navExamples">${text('navExamples')}</span>
        <span class="rail-count">${examples.length}</span>
      </button>
      <button type="button" class="rail-link" data-nav="sec-works" data-active="false">
        <span data-i18n="navWorks">${text('navWorks')}</span>
        <span class="rail-count" id="railWorksCount">0</span>
      </button>
      <button type="button" class="rail-link" data-nav="sec-new" data-active="false">
        <span data-i18n="new">${text('new')}</span>
      </button>
      <button type="button" class="rail-link" data-nav="sec-workflows" data-active="false">
        <span data-i18n="navWorkflows">${text('navWorkflows')}</span>
        <span class="rail-count">${recipes.length}</span>
      </button>
    </nav>

    <div class="rail-group rail-skills-box">
      <div class="rail-group-label" data-i18n="railSkillsLabel">${text('railSkillsLabel')}</div>
      <div id="railSkillLinks" class="rail-group"></div>
    </div>

    <div class="rail-footer">
      <button type="button" class="bda-tool" id="schemeBtn" data-i18n-title="schemeToggle" data-i18n-label="schemeToggle" title="${text('schemeToggle')}" aria-label="${text('schemeToggle')}"></button>
      <button type="button" class="bda-btn" id="languageBtn" data-i18n-title="language" data-i18n-label="language" title="${text('language')}" aria-label="${text('language')}">${text('languageButton')}</button>
      <button type="button" class="bda-tool" id="reloadBtn" data-i18n-title="refresh" data-i18n-label="refresh" title="${text('refresh')}" aria-label="${text('refresh')}">
        <svg viewBox="0 0 16 16" width="15" height="15" stroke="currentColor" stroke-width="1.4" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9L14 6m0-4v4h-4"/></svg>
      </button>
    </div>
  </aside>

  <div class="bda-scroll" id="mainScroll">
    <div class="bda-content">
      <header class="bda-heading">
        <div class="bda-heading-title">
          <h1 data-i18n="works">${text('works')}</h1>
          <p class="bda-subtitle" data-i18n="studioSubtitle">${text('studioSubtitle')}</p>
        </div>
        <div class="bda-tools">
          <div class="bda-search">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input id="q" data-i18n-placeholder="searchPlaceholder" placeholder="${text('searchPlaceholder')}" data-i18n-label="search" aria-label="${text('search')}">
            <button type="button" id="clearSearch" class="hidden" data-i18n-title="clearSearch" title="${text('clearSearch')}" data-i18n-label="clearSearch" aria-label="${text('clearSearch')}">
              <svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.4"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>
            </button>
          </div>
          <button type="button" class="bda-tool" id="filterBtn" data-i18n-title="sortFilter" title="${text('sortFilter')}" data-i18n-label="sortFilter" aria-label="${text('sortFilter')}">
            <svg viewBox="0 0 16 16" width="16" height="16" stroke="currentColor" stroke-width="1.4"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>
          </button>
          <button type="button" class="bda-tool" id="viewModeBtn" data-i18n-title="switchView" title="${text('switchView')}" data-i18n-label="switchView" aria-label="${text('switchView')}">
            <svg id="viewModeIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"></svg>
          </button>
        </div>
      </header>

      <section class="ds-stage" id="sec-ds">
        <div class="ds-hero">
          <div class="ds-hero-orbit" aria-hidden="true"></div>
          <div>
            <div class="ds-eyebrow" id="dsEyebrow" data-ready="false">
              <span class="ds-stat-dot"></span>
              <span id="dsEyebrowText">${text('dsEyebrowDefault')}</span>
            </div>
            <div class="ds-brand-lockup">
              <span class="ds-lakala-mark">lakala<i>.</i></span>
            </div>
            <h2 id="dsHeroTitle">${text('dsHeroTitle')}</h2>
            <p class="ds-hero-desc" id="dsHeroDesc">${text('dsHeroDesc')}</p>
          </div>

          <div class="ds-stats">
            <div class="ds-stat"><span class="ds-stat-dot"></span><span data-i18n="dsStatColors">${text('dsStatColors')}</span></div>
            <div class="ds-stat"><span class="ds-stat-dot"></span><span data-i18n="dsStatThemes">${text('dsStatThemes')}</span></div>
            <div class="ds-stat"><span class="ds-stat-dot"></span><span data-i18n="dsStatType">${text('dsStatType')}</span></div>
            <div class="ds-stat"><span class="ds-stat-dot"></span><span data-i18n="dsStatComps">${text('dsStatComps')}</span></div>
          </div>

          <div class="ds-cta-row">
            <button type="button" class="ds-btn-cyan" id="dsPrimaryBtn">${text('dsInitBtn')}</button>
            <button type="button" class="ds-btn-ghost" id="dsInspectBtn" data-i18n="dsInspectBtn">${text('dsInspectBtn')}</button>
            <button type="button" class="ds-btn-ghost" id="dsAgentBtn" data-i18n="dsAgentBtn">${text('dsAgentBtn')}</button>
          </div>
        </div>

        <div class="ds-lab">
          <div class="ds-lab-bar">
            <div class="ds-tabs" role="tablist">
              <button type="button" class="ds-tab" role="tab" data-ds-tab="colors" aria-selected="true" data-i18n="dsTabColors">${text('dsTabColors')}</button>
              <button type="button" class="ds-tab" role="tab" data-ds-tab="type" aria-selected="false" data-i18n="dsTabType">${text('dsTabType')}</button>
              <button type="button" class="ds-tab" role="tab" data-ds-tab="comps" aria-selected="false" data-i18n="dsTabComps">${text('dsTabComps')}</button>
            </div>
            <div class="ds-theme-switch" role="group" aria-label="Token theme">
              <button type="button" class="ds-theme-btn" data-ds-theme="light" data-on="true">Light</button>
              <button type="button" class="ds-theme-btn" data-ds-theme="dark" data-on="false">Dark</button>
            </div>
          </div>
          <div class="ds-lab-body" id="dsLabBody" data-token-theme="light"></div>
        </div>
      </section>

      <section class="studio-section" id="sec-examples">
        <div class="section-head">
          <h2 class="bda-section-title" data-i18n="examples">${text('examples')}</h2>
          <span class="section-sub" data-i18n="examplesSubtitle">${text('examplesSubtitle')}</span>
        </div>
        <ul id="examples"></ul>
      </section>

      <section class="studio-section" id="sec-works">
        <div class="section-head">
          <div class="works-head-left">
            <h2 class="bda-section-title" id="listHeading" data-i18n="allWorks">${text('allWorks')}</h2>
            <div id="scopeSwitch" class="scope-switch hidden"></div>
          </div>
          <div class="type-pills" id="typePills"></div>
        </div>
        <div id="container"></div>
        <div id="missingTray" class="missing-tray hidden"></div>
      </section>

      <section class="studio-section" id="sec-new">
        <div class="section-head">
          <h2 class="bda-section-title" data-i18n="new">${text('new')}</h2>
          <span class="section-sub" data-i18n="newSubtitle">${text('newSubtitle')}</span>
        </div>
        <ul class="bda-tiles" id="tiles"></ul>
      </section>

      <section class="studio-section" id="sec-workflows">
        <div class="section-head">
          <h2 class="bda-section-title" data-i18n="workflows">${text('workflows')}</h2>
          <span class="section-sub" data-i18n="workflowsSubtitle">${text('workflowsSubtitle')}</span>
        </div>
        <ul id="recipes"></ul>
      </section>
    </div>
  </div>
</div>

<div id="editorView" class="hidden">
  <div class="editor-bar">
    <button type="button" class="bda-btn" id="backBtn" data-i18n="back">${text('back')}</button>
    <span class="title" id="editorTitle"></span>
    <button type="button" class="bda-btn" id="popBtn" data-i18n="popOut">${text('popOut')}</button>
  </div>
  <iframe id="frame" allow="clipboard-read; clipboard-write"></iframe>
</div>

<div id="dialogScrim" class="bda-scrim hidden"></div>
<div id="toast" class="hidden"></div>
<div id="menuLayer"></div>

<script>
const STR = ${safeJson(galleryStr)};
const INITIAL_LANG = ${safeJson(initialLang)};
const TINTS = ${safeJson(tints)};
const SKILLS_CONFIG = ${safeJson(skills)};
const RECIPES = ${safeJson(recipes)};
const OFFICIAL_EXAMPLES = ${safeJson(examples)};
const EXAMPLE_TEMPLATES = ${safeJson(templatesMap)};
const LAKALA_TOKENS = ${safeJson(lakalaTokens)};
const DS_COMPONENTS = ${safeJson(dsComponents)};
${GALLERY_CLIENT_SCRIPT}
</script>
</body>
</html>`;
}
