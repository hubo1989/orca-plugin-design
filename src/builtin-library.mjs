const font = 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const brand = '#00b9f1';
const ink = '#102b46';

export const LAKALA_TOKENS = {
  color: {
    themes: ['light', 'dark'],
    tokens: [
      { name: 'brand-primary', value: brand, usage: '官网品牌青；图形、大标题和强调面。' },
      { name: 'brand-action', value: { light: '#007fa8', dark: '#56d4f7' }, usage: '文字、链接与主交互按钮；满足 AA 对比度。' },
      { name: 'brand-deep', value: '#0b3875', usage: '官网深蓝品牌底色与封面舞台。' },
      { name: 'brand-pale', value: { light: '#e8f8fd', dark: '#12384b' }, usage: '低强调品牌背景与柔和提示面。' },
      { name: 'text-primary', value: { light: ink, dark: '#f0f6fa' }, usage: '核心标题与正文。' },
      { name: 'text-secondary', value: { light: '#536875', dark: '#b1c5d1' }, usage: '辅助说明正文。' },
      { name: 'text-muted', value: { light: '#667c88', dark: '#98aebc' }, usage: '次级元信息与图注，不再叠加透明度。' },
      { name: 'surface-base', value: { light: '#ffffff', dark: '#101e2b' }, usage: '基础画布底色。' },
      { name: 'surface-subtle', value: { light: '#f5f8fa', dark: '#172a39' }, usage: '分区容器、卡片与输入底色。' },
      { name: 'border-default', value: { light: '#d7e3ea', dark: '#365262' }, usage: '结构分隔线与控件边界。' },
      { name: 'state-success', value: { light: '#15734f', dark: '#72dbad' }, usage: '支付成功与正向完成态；须配合文字或图标。' },
      { name: 'state-error', value: { light: '#ba3445', dark: '#ff9bad' }, usage: '异常与表单校验提示。' },
    ],
  },
  type: {
    families: { sans: font },
    fonts: [],
    groups: [{
      name: 'Lakala Sans',
      family: 'sans',
      styles: [
        { name: 'display', fontSize: '64px', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-2px', usage: '封面与品牌主叙事。' },
        { name: 'heading-1', fontSize: '40px', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-1px', usage: '一级章节大标题。' },
        { name: 'heading-2', fontSize: '28px', fontWeight: 600, lineHeight: 1.35, usage: '模块主标题。' },
        { name: 'heading-3', fontSize: '20px', fontWeight: 600, lineHeight: 1.4, usage: '卡片标题与分组小节。' },
        { name: 'body', fontSize: '16px', fontWeight: 400, lineHeight: 1.75, usage: '标准阅读正文。' },
        { name: 'label', fontSize: '14px', fontWeight: 500, lineHeight: 1.5, usage: '按钮、导航与表单标签。' },
        { name: 'caption', fontSize: '12px', fontWeight: 400, lineHeight: 1.6, usage: '时间戳、图注与状态辅助说明。' },
      ],
    }],
  },
  spacing: {
    tokens: [4, 8, 12, 16, 24, 32, 48, 64, 96].map((value) => ({
      name: `space-${value}`,
      value: `${value}px`,
    })),
  },
  radius: {
    tokens: [4, 8, 12, 20, 32].map((value) => ({
      name: `radius-${value}`,
      value: `${value}px`,
    })),
  },
  shadow: {
    tokens: [
      { name: 'shadow-card', value: '0 12px 40px #102b4610' },
      { name: 'shadow-float', value: '0 24px 72px #102b4626' },
    ],
  },
};

const tokenCSS = Object.entries(LAKALA_TOKENS)
  .filter(([family]) => family !== 'type')
  .flatMap(([, family]) => family.tokens.map(({ name, value }) => `--${name}:${typeof value === 'object' ? value.light : value};`))
  .join('');

const baseCSS = `*{box-sizing:border-box}body{margin:0;background:#fff;color:${ink};font-family:${font};-webkit-font-smoothing:antialiased}button,input{font:inherit}button{cursor:pointer;border:0}a{color:#007fa8;text-decoration:none}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #007fa8;outline-offset:4px}h1,h2,h3,p{margin:0}small,.eyebrow{font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase}.logo{font-size:23px;font-weight:750;letter-spacing:-1px}.logo i{font-style:normal;color:${brand}}.pill{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border:1px solid #c9e8f2;border-radius:40px;font-size:11px;color:#00728f;background:#f4fbfe}.button{display:inline-flex;align-items:center;justify-content:center;padding:13px 22px;border-radius:8px;background:#007fa8;color:#fff;font-weight:550;font-size:13px}.button.secondary{background:#eff7fa;color:${ink}}.quiet{color:#536875}.rule{height:1px;background:#dce8ee}.arrow{font-size:21px}.page{min-height:720px;padding:42px 54px;overflow:hidden}section{position:relative}svg{max-width:100%}@media(max-width:650px){.page{padding:26px}.logo{font-size:19px}}`;

const page = (body, css = '', title = '拉卡拉 · 品牌示例') =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{${tokenCSS}}${baseCSS}${css}</style></head><body>${body}</body></html>`;

const dsCard = (marker, body, css = '', title = '拉卡拉 · 组件预览') =>
  `<!-- @dsCard ${marker} -->\n${page(body, css, title)}`;

const dcDocument = (body, css = '', title = '拉卡拉 · 画布示例', width = 1200, height = 800) => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>:root{${tokenCSS}}${baseCSS}.dc-artboard{width:${width}px;min-height:${height}px;overflow:hidden;background:#fff}${css}</style>
</helmet>
<div class="dc-artboard">${body}</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${width},"height":${height}}}'>
class Component extends DCLogic {}
</script>
</body>
</html>`;

const orbit = `<div class="orbit-art" aria-hidden="true"><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div><div class="orbit orbit-c"></div><div class="orbit-core"><span>la</span><span>ka</span><span>la.</span></div><span class="orbit-note">CONNECTED<br>BY DESIGN.</span></div>`;
const orbitCSS = `.orbit-art{position:relative;width:100%;height:330px}.orbit{position:absolute;left:50%;top:50%;width:270px;height:270px;border:1px solid #ffffff45;border-radius:50%;transform:translate(-50%,-50%) rotate(-30deg)}.orbit-b{width:340px;height:180px;transform:translate(-50%,-50%) rotate(-38deg)}.orbit-c{width:190px;height:320px;transform:translate(-50%,-50%) rotate(40deg)}.orbit-a:after{content:'';position:absolute;top:25px;left:38px;width:16px;height:16px;border-radius:50%;background:#6ce0ff;box-shadow:0 0 30px #00b9f188}.orbit-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-12deg);display:flex;flex-direction:column;font-size:67px;letter-spacing:-5px;font-weight:800;line-height:.74;color:#fff}.orbit-core span:nth-child(2){color:#73e0ff}.orbit-note{position:absolute;right:0;bottom:0;color:#a3d7e7;font:9px/1.6 monospace;letter-spacing:2px}`;

const systemCoverBody = `<main class="page brand-cover"><header><span class="logo">la<i>ka</i>la.</span><span class="eyebrow">DESIGN SYSTEM / 01</span></header><div class="brand-body"><div><span class="pill">品牌的每个触点，同一种语言</span><h1>让连接<br>自然而然<span>。</span></h1><p>从一抹品牌青，到每一次被信任的体验。<br>为支付、商业与日常，建立统一的设计语言。</p><div class="cover-tags"><span>品牌规范</span><span>基础变量</span><span>界面组件</span></div></div>${orbit}</div><footer><div class="swatches"><i style="background:#00b9f1"></i><i style="background:#0b3875"></i><i style="background:#102b46"></i><i style="background:#007fa8"></i><i style="background:#e8f8fd"></i></div><small>LAKALA DESIGN LANGUAGE · V1.0</small></footer></main>`;
const systemCoverCSS = `${orbitCSS}.brand-cover{background:#f4f9fb;min-height:720px}.brand-cover header,.brand-cover footer{display:flex;align-items:center;justify-content:space-between}.brand-cover header>.eyebrow{color:#536875}.brand-body{display:grid;grid-template-columns:1.1fr 1fr;gap:50px;align-items:center;margin:72px 0 62px}.brand-body h1{font-size:70px;line-height:1.13;letter-spacing:-3px;margin:26px 0 22px}.brand-body h1>span{color:#00b9f1}.brand-body p{font-size:14px;line-height:1.9;color:#536875}.brand-body .orbit-art{background:#0b3875;border-radius:46% 46% 36% 46%;height:360px;transform:rotate(5deg)}.brand-body .orbit-note{right:20px;bottom:20px}.cover-tags{display:flex;gap:10px;margin-top:30px;font-size:11px}.cover-tags span{border-bottom:1px solid #b8ccd6;padding-bottom:6px}.swatches{display:flex;gap:8px}.swatches i{display:block;width:38px;height:14px;border-radius:3px;border:1px solid #102b460d}.brand-cover footer small{font-size:9px;color:#536875}@media(max-width:650px){.brand-body{gap:25px;margin:40px 0;grid-template-columns:1fr}.brand-body h1{font-size:52px}.brand-body .orbit-art{height:280px}.brand-cover footer{gap:15px;flex-wrap:wrap}}`;
const systemCoverPreview = page(systemCoverBody, systemCoverCSS, '拉卡拉 · 品牌设计系统');
const systemCoverCard = dsCard('group="Overview" height=720 page="true" subtitle="品牌视觉总览与核心色板"', systemCoverBody, systemCoverCSS, '拉卡拉 · 品牌设计系统');

const websiteBody = `<main class="page website"><nav><span class="logo">la<i>ka</i>la.</span><div class="nav-links"><a href="#solutions">商业解决方案</a><a href="#services">服务与支持</a><a href="#about">关于我们</a></div><a class="contact" href="#services">即刻连接 <span>↗</span></a></nav><section class="web-hero"><div class="web-copy"><span class="eyebrow">PAYMENT CONNECTS POSSIBILITY</span><h1>每一次支付，<br>都通向<span>更多可能。</span></h1><p>让生意更轻盈，让连接更自由。<br>以可信赖的数字支付，陪伴每一份经营热爱。</p><a class="button" href="#solutions">探索商业可能 <span style="margin-left:32px">↗</span></a><div class="web-note"><span class="dot"></span> 为每一种商业，找到更好的连接方式</div></div><div class="web-visual"><div class="halo"></div><div class="payment-card"><div class="card-top">拉卡拉 <span>✦</span></div><div class="chip"></div><p>为热爱，<br>全心以付。</p><small>CONNECTED COMMERCE</small></div><div class="receipt"><span>每一份热爱，值得被看见</span><b>支付成功 <i>✓</i></b><div class="receipt-line"></div><small>THANK YOU FOR YOUR TRUST</small></div><span class="visual-caption">SMALL MOMENTS.<br>GREATER POSSIBILITIES.</span></div></section><section class="web-bottom" id="solutions"><span>连接每一种商业可能</span><a href="#services">01 · 便捷收款　↗</a><a href="#services">02 · 商户服务　↗</a><a href="#about">03 · 数字经营　↗</a></section><section id="services"><h2>服务，始终在身边。</h2><p>从收款到经营，提供清晰、便捷的产品体验。</p></section><footer id="about">拉卡拉风格演绎 · Lakala-Design-Plugin 内置设计示例</footer></main>`;
const websiteCSS = `nav{display:flex;align-items:center;gap:24px;justify-content:space-between}.nav-links{display:flex;gap:32px;font-size:12px}.nav-links a{color:#536875}.contact{font-size:12px}.contact span{margin-left:20px}.web-hero{display:grid;grid-template-columns:1.1fr 1fr;min-height:535px;align-items:center;gap:10px}.web-copy>.eyebrow{font-size:10px;letter-spacing:2.5px;color:#007fa8}.web-copy h1{font-size:58px;line-height:1.22;letter-spacing:-2px;margin:25px 0}.web-copy h1 span{color:#007fa8}.web-copy p{font-size:14px;line-height:1.9;color:#536875;margin-bottom:28px}.web-note{font-size:10px;color:#667c88;margin-top:27px}.dot{display:inline-block;width:5px;height:5px;border-radius:100%;background:#00b9f1;margin-right:7px}.web-visual{position:relative;height:420px}.halo{position:absolute;width:360px;height:360px;border-radius:100%;background:#e4f7fd;left:10%;top:8%;box-shadow:0 0 0 30px #f3fbfe,0 0 0 60px #f9fdfe}.payment-card{position:absolute;top:16px;left:20%;width:224px;height:300px;border-radius:20px;background:linear-gradient(150deg,#0b3875,#102b46);color:#fff;padding:26px;transform:rotate(-13deg);box-shadow:15px 30px 45px #14344c26}.card-top{display:flex;justify-content:space-between;font-size:13px}.chip{width:30px;height:24px;border-radius:5px;border:1px solid #b5ddeb;margin:32px 0 22px;background:linear-gradient(90deg,transparent 45%,#b5ddeb 46%,#b5ddeb 50%,transparent 51%)}.payment-card p{font-size:25px;line-height:1.4}.payment-card small{display:block;font-size:7px;letter-spacing:1.5px;margin-top:26px;color:#91d7f0}.receipt{position:absolute;right:0;bottom:12px;width:227px;background:#fff;padding:25px;border:1px solid #e3edf1;box-shadow:0 15px 40px #102b4612;border-radius:12px;transform:rotate(8deg)}.receipt>span{font-size:9px;color:#667c88}.receipt b{display:block;font-size:20px;margin:19px 0}.receipt b i{float:right;font-style:normal;color:#007fa8;background:#e8f8fd;border-radius:100%;font-size:13px;padding:4px 6px}.receipt-line{border-top:1px dashed #c4d8e2;margin-bottom:14px}.receipt small{font-size:6px;letter-spacing:1px;color:#667c88}.visual-caption{position:absolute;left:8%;bottom:10px;font:8px/1.7 monospace;letter-spacing:2px;color:#667c88}.web-bottom{display:flex;align-items:center;justify-content:space-between;border-top:1px solid #dce8ee;padding:25px 0;font-size:11px}.web-bottom>span{color:#667c88}#services{margin-top:55px;padding:35px;background:#f5f8fa;border-radius:12px}#services h2{font-size:26px;margin-bottom:14px}#services p,footer{color:#536875;font-size:12px}footer{margin-top:30px}@media(max-width:700px){.nav-links{display:none}.web-hero{grid-template-columns:1fr}.web-copy{padding-top:48px}.web-copy h1{font-size:42px}.web-visual{margin:30px auto;width:340px;max-width:100%}.web-bottom{gap:15px;flex-wrap:wrap}}`;
const websitePreview = page(websiteBody, websiteCSS, '拉卡拉 · 数字商业首页');
const websiteDC = dcDocument(websiteBody, websiteCSS, '数字商业 · 品牌首页', 1200, 800);

// claude-slides 原生单页格式：<section> 画布自身固定 1920x1080，不设 width/height
const slideCoverSection = `<section id="cover" data-section="拉卡拉数字商业品牌提案封面" style="background:linear-gradient(135deg, #0b3875 0%, #102b46 100%);color:#ffffff;padding:88px 128px;display:flex;flex-direction:column;justify-content:space-between;font-family:sans-serif">
  <x-shape kind="ellipse" style="position:absolute;left:1180px;top:170px;width:580px;height:580px;border:2px solid rgba(108,224,255,0.28);background:rgba(0,185,241,0.08)"></x-shape>
  <x-shape kind="ellipse" style="position:absolute;left:1290px;top:280px;width:360px;height:360px;border:2px solid rgba(255,255,255,0.22);background:rgba(0,185,241,0.14)"></x-shape>
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
    <p style="font-size:34px;font-weight:700;letter-spacing:-1px;color:#ffffff">la<span style="color:#00b9f1">ka</span>la.</p>
    <p style="font-size:24px;letter-spacing:3px;color:#9dbdce">BRAND &amp; BUSINESS / 2026</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:28px;max-width:1060px">
    <p style="font-size:24px;font-weight:600;letter-spacing:4px;color:#67d9fc">CONNECTING THE NEXT</p>
    <h1 style="font-size:96px;font-weight:700;line-height:1.15;letter-spacing:-2px;color:#ffffff">支付的下一站，<br><span style="color:#67d9fc">是每一种可能。</span></h1>
    <p style="font-size:32px;line-height:1.5;color:#c7dce8">拉卡拉 · 数字商业品牌与体验设计提案</p>
    <div style="width:96px;height:6px;background:#00b9f1;border-radius:3px"></div>
    <p style="font-size:26px;color:#9dbdce">以统一的设计语言连接信任，让每一笔交易自然发生。</p>
  </div>
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,0.16);padding:28px 0 0 0">
    <p style="font-size:24px;letter-spacing:2px;color:#9dbdce">LAKALA DESIGN EXPLORATION</p>
    <p style="font-size:24px;color:#67d9fc">01 / 03</p>
  </div>
</section>`;

const slidePrinciplesSection = `<section id="principles" data-section="三大核心设计原则" style="background:#f5f8fa;color:#102b46;padding:88px 128px;display:flex;flex-direction:column;justify-content:space-between;font-family:sans-serif">
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
    <p style="font-size:32px;font-weight:700;color:#102b46">la<span style="color:#00b9f1">ka</span>la.</p>
    <p style="font-size:24px;letter-spacing:3px;color:#536875">02 / DESIGN PRINCIPLES</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:48px">
    <h2 style="font-size:68px;font-weight:700;line-height:1.2;letter-spacing:-1px;color:#102b46">好的连接，从清晰可信的体验开始。</h2>
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:40px">
      <div style="background:#ffffff;border:1px solid #d7e3ea;border-radius:20px;padding:44px;display:flex;flex-direction:column;gap:20px">
        <p style="font-size:26px;font-weight:700;color:#007fa8">01 · TRUST</p>
        <h3 style="font-size:40px;font-weight:600;color:#102b46">可信赖</h3>
        <p style="font-size:26px;line-height:1.6;color:#536875">清楚呈现每一个关键状态与金额反馈，让复杂交易流程有据可循。</p>
      </div>
      <div style="background:#ffffff;border:1px solid #d7e3ea;border-radius:20px;padding:44px;display:flex;flex-direction:column;gap:20px">
        <p style="font-size:26px;font-weight:700;color:#007fa8">02 · CLARITY</p>
        <h3 style="font-size:40px;font-weight:600;color:#102b46">更轻盈</h3>
        <p style="font-size:26px;line-height:1.6;color:#536875">克制装饰噪音，以充足留白和品牌青引导视线聚焦唯一主行动。</p>
      </div>
      <div style="background:#ffffff;border:1px solid #d7e3ea;border-radius:20px;padding:44px;display:flex;flex-direction:column;gap:20px">
        <p style="font-size:26px;font-weight:700;color:#007fa8">03 · WARMTH</p>
        <h3 style="font-size:40px;font-weight:600;color:#102b46">有温度</h3>
        <p style="font-size:26px;line-height:1.6;color:#536875">用自然直观的语言回应真实经营日常，让工具成为可靠伙伴。</p>
      </div>
    </div>
  </div>
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
    <p style="font-size:24px;color:#667c88">LAKALA DESIGN LANGUAGE · SYSTEM TOKENS</p>
    <p style="font-size:24px;color:#007fa8">02 / 03</p>
  </div>
</section>`;

const slideClosingSection = `<section id="closing" data-section="总结与展望" style="background:#e8f8fd;color:#102b46;padding:96px 128px;display:flex;flex-direction:column;justify-content:space-between;font-family:sans-serif">
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center">
    <p style="font-size:32px;font-weight:700;color:#102b46">la<span style="color:#00b9f1">ka</span>la.</p>
    <p style="font-size:24px;letter-spacing:3px;color:#007fa8">03 / CONNECTED BY DESIGN</p>
  </div>
  <div style="display:flex;flex-direction:column;gap:32px;max-width:1280px">
    <h1 style="font-size:88px;font-weight:700;line-height:1.18;letter-spacing:-2px;color:#102b46">让每一份经营热爱，<br><span style="color:#007fa8">都被认真以待。</span></h1>
    <p style="font-size:34px;line-height:1.6;color:#536875">用统一的设计系统串联网页、移动端与商业演示，开启下一次连接。</p>
    <div style="width:120px;height:8px;background:#00b9f1;border-radius:4px"></div>
  </div>
  <div style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;border-top:1px solid #c5e2ee;padding:28px 0 0 0">
    <p style="font-size:24px;letter-spacing:2px;color:#536875">ORCA-DESIGN BUILTIN DECK</p>
    <p style="font-size:24px;color:#007fa8">03 / 03</p>
  </div>
</section>`;

const slideCoverPreview = page(
  `<main class="slide"><header><span class="logo">la<i>ka</i>la.</span><span>BRAND &amp; BUSINESS / 2026</span></header><div class="slide-copy"><span class="eyebrow">CONNECTING THE NEXT</span><h1>支付的下一站，<br><span>是每一种可能。</span></h1><p>拉卡拉 · 数字商业品牌提案</p><div class="slide-rule"></div><span class="slide-caption">以设计连接信任，以科技连接生意。</span></div><div class="slide-art">${orbit}</div><footer><span>LAKALA / DESIGN EXPLORATION</span><span>01 — 03</span></footer></main>`,
  `${orbitCSS}.slide{position:relative;width:100%;min-height:720px;background:linear-gradient(135deg,#0b3875,#102b46);color:#fff;padding:48px 60px;overflow:hidden}.slide header,.slide footer{display:flex;justify-content:space-between;align-items:center}.slide header>span:last-child{font-size:10px;letter-spacing:2px;color:#9dbdce}.slide-copy{position:relative;z-index:2;margin-top:92px;max-width:620px}.slide-copy>.eyebrow{color:#67d9fc;font-size:11px;letter-spacing:3px}.slide-copy h1{font-size:64px;line-height:1.2;letter-spacing:-2px;margin:24px 0}.slide-copy h1>span{color:#67d9fc}.slide-copy p{font-size:17px;color:#c0d4df}.slide-rule{width:58px;height:3px;background:#00b9f1;margin:32px 0 18px}.slide-caption{font-size:12px;color:#9dbdce}.slide-art{position:absolute;right:54px;top:140px;width:360px}.slide-art .orbit-art{height:340px}.slide-art .orbit-core{font-size:84px}.slide footer{position:absolute;left:60px;right:60px;bottom:36px;color:#9dbdce;font-size:10px;letter-spacing:1.7px}`,
  '拉卡拉 · 数字商业提案',
);

const mobileBody = `<main class="page mobile-layout"><div class="mobile-story"><span class="eyebrow">EVERYDAY, SIMPLIFIED.</span><h1>把日常经营，<br>交给<span>更轻松的体验。</span></h1><p>信息有层次，操作有回应。<br>以一套有温度的组件，串联商户的每一天。</p><div class="mobile-chips"><span>移动端界面</span><span>商户服务</span><span>品牌组件</span></div><div class="logo">la<i>ka</i>la.</div></div><div class="phone"><div class="phone-camera"></div><div class="phone-status"><span>9:41</span><span>▮▮▮　▰</span></div><header><div><small>美好的一天，从这里开始</small><h2>你好，小拉商店 <span>☀</span></h2></div><span class="avatar">拉</span></header><section class="phone-banner"><small>轻松收款，安心经营</small><h3>每一份热爱<br>都值得被看见。</h3><span class="banner-orb">↗</span></section><section class="quick-actions"><button type="button"><i>⌁</i><span>扫一扫</span></button><button type="button"><i>▦</i><span>收款码</span></button><button type="button"><i>↗</i><span>转账</span></button><button type="button"><i>☷</i><span>交易记录</span></button></section><div class="service-title"><h3>经营好帮手</h3><span>查看全部 ↗</span></div><article class="service-card"><i>✦</i><div><b>让小店经营更有序</b><p>发现适合你的商户服务</p></div><span>›</span></article><article class="service-card"><i>♡</i><div><b>每一次帮助，都在身边</b><p>服务支持 · 随时连接</p></div><span>›</span></article><nav class="phone-nav"><span class="selected">⌂<small>首页</small></span><span>▧<small>服务</small></span><span>♧<small>消息</small></span><span>○<small>我的</small></span></nav></div></main>`;
const mobileCSS = `.mobile-layout{display:grid;grid-template-columns:1.1fr 1fr;gap:60px;align-items:center;background:#f1f7f9;min-height:800px}.mobile-story>.eyebrow{color:#007fa8;font-size:10px}.mobile-story h1{font-size:49px;line-height:1.3;letter-spacing:-2px;margin:28px 0}.mobile-story h1 span{color:#007fa8}.mobile-story>p{font-size:14px;line-height:1.9;color:#536875}.mobile-chips{display:flex;gap:8px;margin:30px 0 70px}.mobile-chips>span{font-size:10px;border:1px solid #cfdee5;padding:8px 10px;border-radius:4px;background:#fff}.phone{background:#fff;width:320px;min-height:655px;border:7px solid #102b46;border-radius:42px;position:relative;overflow:hidden;padding:20px;box-shadow:20px 30px 55px #102b461b;justify-self:center;transform:rotate(3deg)}.phone-camera{position:absolute;top:8px;left:112px;width:82px;height:19px;background:#102b46;border-radius:14px}.phone-status{display:flex;justify-content:space-between;font-size:10px;font-weight:600;padding:5px 3px 24px}.phone header{display:flex;justify-content:space-between;align-items:center}.phone header small{font-size:8px;color:#667c88;letter-spacing:0}.phone h2{font-size:16px;margin-top:6px}.phone h2 span{color:#007fa8}.avatar{width:32px;height:32px;background:#e8f8fd;display:grid;place-items:center;border-radius:11px;color:#007fa8;font-size:12px}.phone-banner{position:relative;background:#0b3875;border-radius:14px;color:#fff;padding:22px;margin:24px 0;overflow:hidden}.phone-banner small{font-size:9px;letter-spacing:0;color:#a6d6e7}.phone-banner h3{font-size:21px;line-height:1.5;margin-top:10px}.banner-orb{position:absolute;right:-5px;bottom:-20px;width:120px;height:120px;border-radius:100%;border:1px solid #ffffff40;display:grid;place-items:center;font-size:65px;color:#74e0ff}.quick-actions{display:flex;justify-content:space-between;padding:0 2px 25px}.quick-actions button{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;padding:0;color:#536875;font-size:9px}.quick-actions i{font-style:normal;display:grid;place-items:center;background:#e8f8fd;color:#007fa8;width:42px;height:42px;border-radius:13px;font-size:23px}.service-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.service-title h3{font-size:13px}.service-title>span{font-size:8px;color:#667c88}.service-card{display:flex;align-items:center;gap:10px;background:#f5f8fa;border-radius:10px;padding:15px 10px;margin:8px 0}.service-card>i{font-style:normal;font-size:22px;color:#007fa8}.service-card b{font-size:10px;font-weight:550}.service-card p{font-size:8px;color:#667c88;margin-top:5px}.service-card>span{margin-left:auto;color:#667c88}.phone-nav{display:flex;justify-content:space-around;border-top:1px solid #edf2f5;margin:22px -20px -20px;padding:16px 10px 19px;color:#667c88}.phone-nav>span{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:19px}.phone-nav small{font-size:8px;letter-spacing:0;font-weight:400}.phone-nav .selected{color:#007fa8}@media(max-width:700px){.mobile-layout{grid-template-columns:1fr;gap:25px}.mobile-story h1{font-size:38px}.mobile-chips{margin-bottom:25px}.phone{transform:none}}`;
const mobilePreview = page(mobileBody, mobileCSS, '拉卡拉 · 商户移动端');
const mobileDC = dcDocument(mobileBody, mobileCSS, '轻盈日常 · 商户移动端', 1200, 800);

const posterBody = `<main class="poster"><header><span class="logo">la<i>ka</i>la.</span><span class="poster-tag">BRAND EXPLORATION<br>VOL. 01 / 2026</span></header><div class="poster-visual"><div class="poster-ring ring-one"></div><div class="poster-ring ring-two"></div><span class="poster-symbol">↗</span><span class="poster-micro">A LITTLE CONNECTION.<br>A WORLD OF POSSIBILITY.</span></div><div class="poster-copy"><span class="eyebrow">连接 · 每一种可能</span><h1>小小一付，<br>大有可为。</h1><p>认真经营的每一天，都在创造新的可能。</p></div><footer><span>PAYMENT. PEOPLE. POSSIBILITIES.</span><span>LAKALA © DESIGN STUDY</span></footer></main>`;
const posterCSS = `.poster{background:#00b9f1;width:100%;min-height:800px;position:relative;padding:40px 52px;overflow:hidden}.poster header{display:flex;justify-content:space-between;align-items:center}.poster .logo{font-size:28px}.poster .logo i{color:#fff}.poster-tag{font:9px/1.6 monospace;letter-spacing:1px}.poster-visual{position:absolute;right:-30px;top:90px;width:500px;height:560px}.poster-ring{position:absolute;width:420px;height:420px;border:1px solid #102b4638;border-radius:50%;top:40px;left:20px}.ring-two{width:330px;height:490px;transform:rotate(35deg);top:0;left:60px}.poster-symbol{position:absolute;top:-110px;left:-10px;font-size:500px;line-height:1.4;color:#fff;font-weight:300;transform:rotate(-10deg);text-shadow:15px 20px 0 #102b4612}.poster-micro{position:absolute;bottom:60px;right:80px;font:8px/1.7 monospace;letter-spacing:2px}.poster-copy{position:relative;z-index:1;margin-top:145px}.poster-copy>.eyebrow{font-size:12px;letter-spacing:4px}.poster-copy h1{font-size:97px;line-height:1.13;letter-spacing:-5px;margin:24px 0 27px}.poster-copy p{font-size:14px}.poster footer{display:flex;justify-content:space-between;border-top:1px solid #102b4636;padding-top:18px;margin-top:95px;font:8px monospace;letter-spacing:1.2px;color:#102b46}@media(max-width:650px){.poster{padding:30px;min-height:740px}.poster-copy h1{font-size:68px;letter-spacing:-3px}.poster-visual{right:-180px;opacity:.65}.poster footer{gap:25px;line-height:1.8}}`;
const posterPreview = page(posterBody, posterCSS, '拉卡拉 · 品牌海报');
const posterDC = dcDocument(posterBody, posterCSS, '大有可为 · 品牌海报', 1000, 800);

const componentCard = (marker, body, css = '') =>
  dsCard(marker, `<main class="component-demo">${body}</main>`, `.component-demo{padding:32px;min-height:180px;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap}${css}`);

const components = {
  Button: {
    html: componentCard(
      'group="Actions" height=200 subtitle="主按钮、次按钮与禁用态"',
      '<button type="button" class="button">立即连接 <span style="margin-left:20px">↗</span></button><button type="button" class="button secondary">了解更多</button><button type="button" class="button" disabled>暂不可用</button>',
      'button:disabled{cursor:not-allowed;opacity:.45}',
    ),
    doc: '# Button\n\n让主要行动清晰可辨。每个区域保留一个主按钮，次要行动使用浅色底。\n\n使用 brand-action 作为实心底色，白色标签；品牌青仅用于装饰面。最小高度 44px，支持键盘 focus-visible 与原生 disabled 状态。\n',
  },
  Form: {
    html: componentCard(
      'group="Inputs" height=300 subtitle="带可见标签与无障碍反馈的表单输入"',
      '<form onsubmit="event.preventDefault();this.querySelector(\'output\').textContent=\'已保存示例信息\'"><label for="shop">商户名称</label><input id="shop" name="shop" placeholder="请输入商户名称" required maxlength="50"><p>用于个性化你的经营服务。</p><button class="button" type="submit">保存信息</button><output aria-live="polite"></output></form>',
      'form{width:300px}label{display:block;font-size:13px;margin-bottom:8px}input{width:100%;border:1px solid #9db6c5;border-radius:8px;padding:12px;color:#102b46;background:#fff}form p{font-size:11px;color:#536875;margin:8px 0 20px}output{display:block;font-size:12px;margin-top:12px;color:#15734f}',
    ),
    doc: '# Form\n\n字段使用持续可见的 label，不以 placeholder 代替名称。辅助说明紧随输入框。\n\n错误同时使用文字和 state-error，提交成功使用 aria-live。输入框最小高度 44px；聚焦边界与背景对比不低于 3:1。\n',
  },
  Card: {
    html: componentCard(
      'group="Surfaces" height=340 subtitle="服务信息卡片与主行动组合"',
      '<article class="service"><span class="pill">商户服务</span><h2>让每一份热爱，<br>都被认真以待。</h2><p>清晰的内容层次，稳定的品牌表达。</p><a href="#details" class="button">了解更多 ↗</a><p id="details">从收款到经营，连接更轻松的日常。</p></article>',
      '.service{background:#f5f8fa;padding:30px;border-radius:16px;width:360px}.service h2{font-size:25px;line-height:1.4;margin:20px 0 15px}.service p{font-size:13px;color:#536875;line-height:1.8;margin-bottom:22px}#details{margin:20px 0 0}',
    ),
    doc: '# Card\n\n卡片将一个主题与一个主要行动组合。以边框或浅背景分组，避免重复使用厚重阴影。\n\n内边距 24–32px，标题与正文间距 12–16px。内容长度变化时保持自然高度；链接保留明确目标。\n',
  },
  Navigation: {
    html: componentCard(
      'group="Navigation" height=160 subtitle="顶部品牌导航与当前页指示"',
      '<nav aria-label="品牌导航"><span class="logo">la<i>ka</i>la.</span><a href="#home" aria-current="page">品牌首页</a><a href="#service">商业服务</a><a href="#contact">联系我们 ↗</a></nav>',
      'nav{display:flex;align-items:center;justify-content:space-between;width:100%;gap:25px;flex-wrap:wrap;padding:20px 0;border-bottom:1px solid #d7e3ea}nav a{font-size:13px}nav a[aria-current]{border-bottom:2px solid #007fa8;padding-bottom:8px}',
    ),
    doc: '# Navigation\n\n稳定的导航帮助用户确认位置。使用语义化 nav 与可理解的 aria-label；当前页以 aria-current 标识。\n\n移动端允许换行或折叠导航，保持最小 44px 点击区域。不以仅有悬浮提示的图标承载关键入口。\n',
  },
};

const brandBook = `# 拉卡拉 · 品牌设计系统

让连接自然而然。以拉卡拉官方网站首页为视觉依据，提炼一套可被产品界面、演示文稿与品牌传播共同使用的设计语言。

> 这是 Lakala-Design-Plugin 基于公开官网提炼的设计研究与内置默认设计系统，并非拉卡拉官方发布的品牌手册。示例文案用于设计演示，不代表真实业务承诺。

## 品牌基因

- **清晰**：强层次、克制留白，一个区域聚焦一个主要行动。
- **可信赖**：深蓝承载关键信息，明确反馈每一个交易与交互状态。
- **有连接感**：以圆形轨道、流动曲线和品牌青表达支付与商业的连接。

## 色彩

官网样式中的品牌青为 \`#00B9F1\`，深蓝为 \`#0B3875\`，冷灰背景为 \`#F5F8FA\`。衍生的正文色、交互色、间距及圆角为本设计系统的配套规范。

品牌青直接承载白色小字对比度不足，主交互按钮统一使用 \`#007FA8\`，品牌青用于强调图形、徽标与大面积视觉面。正文使用 \`#102B46\`，辅助文字使用 \`#536875\`。

## 字体

中文使用 PingFang SC / Microsoft YaHei，西文使用 Inter 与系统 sans-serif。展示标题 64px、一级标题 40px、正文 16px / 1.75、标签 14px；零远程字体依赖，离线环境同样保持完整层级。

## 版式

以 8px 为基础节奏，4px 用于局部微调。大区域留白 48–96px，卡片内边距 24–32px。每屏保留一个主要视觉焦点，优先通过字重、留白与明度对比建立秩序。

## 组件

组件库包含 Cover（品牌总览）以及 Button、Form、Card、Navigation 四类实时 HTML 预览与规范说明，全部共享同一套语义 token。

## 视觉依据

- 官网参考：https://www.lakala.com/
- 品牌主色：官网 \`inicss.css\` 与 \`qnindex.css\` 中的 \`#00b9f1\`
- 深蓝底色：官网 \`index.css\` 中的 \`#0b3875\`
- 字体栈依据：官网 \`inicss.css\` 中的 PingFangSC-Regular / Microsoft YaHei
`;

const systemFiles = {
  'project/design-system.json': '__INDEX__',
  'project/README.md': brandBook,
  'project/principles.md': '# 设计原则\n\n## 清晰\n每屏保留一个主要行动，用留白和层次减少选择负担。\n\n## 可信赖\n所有操作提供明确状态，重要信息不单独依赖颜色表达。\n\n## 有温度\n使用简洁、具体的文字；错误提示说明原因与可执行的下一步。\n\n## 保持一致\n全局引用同一套语义 token，避免不同页面重复硬编码近似色值。\n',
  'project/accessibility.md': '# 无障碍与动效\n\n- 普通正文对比度至少 4.5:1，大号标题至少 3:1。\n- 品牌青 #00B9F1 不承载白色小字，实心主按钮改用 #007FA8。\n- 按钮与输入框最小可点击高度 44px，键盘 focus-visible 焦点环清晰可见。\n- 表单字段提供持续可见的 label，状态变更配合文字与 aria-live。\n- 尊重 prefers-reduced-motion，内置示例不依赖闪烁动效或外部 CDN。\n',
  'project/tokens.json': JSON.stringify(LAKALA_TOKENS, null, 2) + '\n',
  'project/components/Cover/preview.html': systemCoverCard,
  'project/components/Cover/README.md': '# Cover\n\n从官网主色与留白节奏中提炼的品牌总览；使用原创几何轨道表达连接。\n',
  ...Object.fromEntries(
    Object.entries(components).flatMap(([name, { html, doc }]) => [
      [`project/components/${name}/preview.html`, html],
      [`project/components/${name}/README.md`, doc],
    ]),
  ),
};

const canvasIndex = (title, width = 1200, height = 800) => ({
  v: 3,
  launch: { view: 'canvas' },
  pages: [],
  boards: { 'Main.dc.html': { x: 0, y: 0, w: width, h: height, title } },
  order: ['Main.dc.html'],
  notes: {},
  designSystems: [],
});

export const BUILTIN_EXAMPLES = [
  {
    id: 'claude-design-system',
    skill: 'claude-design-system',
    dirName: 'lakala-design-system',
    title: '拉卡拉 · 品牌设计系统',
    titleEn: 'Lakala · Brand design system',
    desc: '提炼自拉卡拉官网的品牌青与深蓝视觉体系，含双主题 Token、5 套实时组件与品牌规范手册。',
    descEn: 'Distilled from Lakala’s brand identity: dual-theme tokens, 5 live component cards, and brand guidelines.',
    points: '12 枚双主题色彩 Token、7 级字阶、5 套实时组件预览（Cover / Button / Form / Card / Navigation）与无障碍手册。',
    pointsEn: '12 dual-theme color tokens, 7 type styles, 5 live component previews, and accessibility docs.',
    label: 'DEFAULT DESIGN SYSTEM',
    featured: true,
    html: systemCoverPreview,
    files: systemFiles,
    index: {
      v: 3,
      layout: 'files',
      namespace: 'LakalaDesignSystem',
      libraries: [],
      sections: {},
      groups: [],
      assetGroups: {},
      blobs: {},
      docs: { readme: 'project/README.md', sections: ['project/principles.md', 'project/accessibility.md'] },
      lastChange: {},
    },
  },
  {
    id: 'claude-design',
    skill: 'claude-design',
    dirName: 'lakala-website',
    title: '数字商业 · 品牌首页',
    titleEn: 'Connected commerce · Website',
    desc: '开阔留白、品牌青点缀与立体支付卡片，构筑干练可信的数字商业第一印象。',
    descEn: 'Generous whitespace, brand cyan accents, and sculpted payment cards for a confident hero landing page.',
    points: '1200 × 800 可编辑 DC 画布，含品牌导航、双栏主视觉、立体支付卡、电子回单与三大业务入口。',
    pointsEn: '1200 × 800 editable DC artboard with navigation, split hero, payment card visual, and solution links.',
    label: 'WEB LANDING',
    html: websitePreview,
    files: { 'project/canvas.json': '__INDEX__', 'project/Main.dc.html': websiteDC },
    index: canvasIndex('数字商业 · 品牌首页', 1200, 800),
  },
  {
    id: 'claude-slides',
    skill: 'claude-slides',
    dirName: 'lakala-brand-deck',
    title: '连接下一站 · 品牌提案',
    titleEn: 'Connecting the next · Brand deck',
    desc: '深蓝星空轨道封面、三栏设计原则与青色收束页，一套可直接演示的三页提案。',
    descEn: 'A three-slide presentation with a deep navy cover, three-pillar principles, and a crisp closing slide.',
    points: '1920 × 1080 标准演示画布，含封面、设计原则、收束共 3 页原生可编辑幻灯片。',
    pointsEn: '1920 × 1080 native editable deck: cover, design principles, and closing slides.',
    label: 'PRESENTATION · 3 SLIDES',
    html: slideCoverPreview,
    files: {
      'project/deck.json': '__INDEX__',
      'project/slides/cover.html': slideCoverSection,
      'project/slides/principles.html': slidePrinciplesSection,
      'project/slides/closing.html': slideClosingSection,
    },
    index: {
      v: 4,
      lists: 'css',
      order: ['cover', 'principles', 'closing'],
      cover: 'cover',
      sections: {},
      faces: {},
      designSystems: [],
    },
  },
  {
    id: 'lakala-mobile',
    skill: 'claude-design',
    dirName: 'lakala-mobile',
    title: '轻盈日常 · 商户移动端',
    titleEn: 'Everyday, simplified · Merchant App',
    desc: '把高频收款、账单核对与经营助手放进清晰亲和的掌上工作台。',
    descEn: 'A friendly mobile merchant workspace bringing QR collection, ledger shortcuts, and daily services together.',
    points: '1200 × 800 可编辑移动端展示画布，含手机样机、快捷收款金刚区、经营服务卡与底部标签栏。',
    pointsEn: '1200 × 800 editable mobile showcase with device frame, quick payment actions, service cards, and tab bar.',
    label: 'MOBILE UI',
    html: mobilePreview,
    files: { 'project/canvas.json': '__INDEX__', 'project/Main.dc.html': mobileDC },
    index: canvasIndex('轻盈日常 · 商户移动端', 1200, 800),
  },
  {
    id: 'lakala-poster',
    skill: 'claude-design',
    dirName: 'lakala-brand-poster',
    title: '大有可为 · 品牌视觉海报',
    titleEn: 'A world of possibility · Brand poster',
    desc: '高饱和品牌青满版构图，搭配几何双环轨道与超大号中文标题张力。',
    descEn: 'Full-bleed Lakala cyan composition pairing orbital geometry with expressive Chinese display typography.',
    points: '1000 × 800 可编辑品牌海报画布，满版品牌青底色、双轨道几何图形与版式栅格页脚。',
    pointsEn: '1000 × 800 editable poster artboard with brand cyan ground, orbital rings, and editorial footer.',
    label: 'BRAND POSTER',
    html: posterPreview,
    files: { 'project/canvas.json': '__INDEX__', 'project/Main.dc.html': posterDC },
    index: canvasIndex('大有可为 · 品牌视觉海报', 1000, 800),
  },
];

export const BUILTIN_BY_ID = Object.fromEntries(BUILTIN_EXAMPLES.map((example) => [example.id, example]));
export const BUILTIN_TEMPLATES = Object.fromEntries(
  BUILTIN_EXAMPLES.map(({ id, skill, dirName, files, index, title }) => [
    id,
    { skill, dirName, files, index, title },
  ]),
);
export const BUILTIN_INDEX = Object.fromEntries(BUILTIN_EXAMPLES.map(({ id, index }) => [id, index]));
