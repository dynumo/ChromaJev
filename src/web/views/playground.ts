import { html, type SafeHtml } from '../../util/html.js';

/**
 * The component playground. Pure markup: every colour comes from the theme
 * custom properties set on `.pg-root[data-mode]` (see playground.css), so
 * switching mode is a single attribute change and nothing here hard-codes a
 * palette.
 */
export const SCENES = [
  ['components', 'Components'],
  ['dashboard', 'SaaS dashboard'],
  ['landing', 'Landing page'],
  ['article', 'Documentation'],
  ['mobile', 'Mobile app'],
] as const;

const icon = {
  check: html`<svg viewBox="0 0 20 20" aria-hidden="true" class="pg-icon"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warn: html`<svg viewBox="0 0 20 20" aria-hidden="true" class="pg-icon"><path d="M10 3l8 14H2L10 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  error: html`<svg viewBox="0 0 20 20" aria-hidden="true" class="pg-icon"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  info: html`<svg viewBox="0 0 20 20" aria-hidden="true" class="pg-icon"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 9v5M10 6v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

function alert(kind: 'success' | 'warning' | 'error' | 'info', title: string, body: string): SafeHtml {
  return html`<div class="pg-alert pg-alert-${kind}" role="note">${icon[kind === 'success' ? 'check' : kind === 'warning' ? 'warn' : kind]}<div><strong>${title}</strong><p>${body}</p></div></div>`;
}

function components(): SafeHtml {
  return html`
  <div class="pg-grid">
    <section class="pg-block">
      <h4 class="pg-block-title">Typography</h4>
      <h1 class="pg-h1">Colour that means something</h1>
      <h2 class="pg-h2">A secondary heading</h2>
      <p>Body copy sits on the page background. It should be comfortable to read for long passages, with links like <a class="pg-link" href="#" tabindex="-1">this text link</a> standing out without shouting.</p>
      <p class="pg-muted">Muted helper text explains a field or adds context.</p>
      <p>Inline code: <code class="pg-code">--primary-foreground</code></p>
    </section>

    <section class="pg-block">
      <h4 class="pg-block-title">Buttons</h4>
      <div class="pg-states">
        <span class="pg-state-label">Normal</span>
        <button class="pg-btn pg-btn-primary" type="button" tabindex="-1">Primary</button>
        <button class="pg-btn pg-btn-secondary" type="button" tabindex="-1">Secondary</button>
        <button class="pg-btn pg-btn-outline" type="button" tabindex="-1">Outline</button>
        <button class="pg-btn pg-btn-ghost" type="button" tabindex="-1">Ghost</button>
        <button class="pg-btn pg-btn-destructive" type="button" tabindex="-1">Delete</button>
      </div>
      <div class="pg-states">
        <span class="pg-state-label">Hover</span>
        <button class="pg-btn pg-btn-primary is-hover" type="button" tabindex="-1">Primary</button>
        <button class="pg-btn pg-btn-secondary is-hover" type="button" tabindex="-1">Secondary</button>
        <button class="pg-btn pg-btn-outline is-hover" type="button" tabindex="-1">Outline</button>
        <button class="pg-btn pg-btn-ghost is-hover" type="button" tabindex="-1">Ghost</button>
        <button class="pg-btn pg-btn-accent is-hover" type="button" tabindex="-1">Accent</button>
      </div>
      <div class="pg-states">
        <span class="pg-state-label">Focus</span>
        <button class="pg-btn pg-btn-primary is-focus" type="button" tabindex="-1">Primary</button>
        <button class="pg-btn pg-btn-outline is-focus" type="button" tabindex="-1">Outline</button>
        <button class="pg-btn pg-btn-accent" type="button" tabindex="-1">Accent</button>
      </div>
      <div class="pg-states">
        <span class="pg-state-label">Disabled</span>
        <button class="pg-btn pg-btn-primary" type="button" disabled>Primary</button>
        <button class="pg-btn pg-btn-outline" type="button" disabled>Outline</button>
      </div>
    </section>

    <section class="pg-block">
      <h4 class="pg-block-title">Forms</h4>
      <div class="pg-field"><label class="pg-label">Project name</label><input class="pg-input" value="Northern Lights" tabindex="-1"></div>
      <div class="pg-field"><label class="pg-label">Email</label><input class="pg-input is-focus" placeholder="you@example.com" tabindex="-1"><p class="pg-help">We only use this for receipts.</p></div>
      <div class="pg-field"><label class="pg-label">Website</label><input class="pg-input is-invalid" value="not a url" tabindex="-1" aria-invalid="true"><p class="pg-error-text">${icon.error} Enter a full URL starting with https://</p></div>
      <div class="pg-field"><label class="pg-label">Plan</label><select class="pg-input" tabindex="-1"><option>Team — £24/month</option></select></div>
      <div class="pg-field"><label class="pg-label">Notes</label><textarea class="pg-input" rows="2" tabindex="-1">Launch in spring.</textarea></div>
      <div class="pg-row">
        <label class="pg-check"><input type="checkbox" checked tabindex="-1"><span>Email me updates</span></label>
        <label class="pg-check"><input type="radio" name="pg-r" checked tabindex="-1"><span>Monthly</span></label>
        <label class="pg-check"><input type="radio" name="pg-r" tabindex="-1"><span>Yearly</span></label>
      </div>
      <div class="pg-row"><span class="pg-switch is-on" aria-hidden="true"><span></span></span><span>Notifications on</span><span class="pg-switch" aria-hidden="true"><span></span></span><span class="pg-muted">Beta features</span></div>
    </section>

    <section class="pg-block">
      <h4 class="pg-block-title">Cards</h4>
      <div class="pg-cards">
        <div class="pg-card"><h5>Standard card</h5><p class="pg-muted">Sits on the surface colour with a border.</p></div>
        <div class="pg-card pg-card-elevated"><h5>Elevated card</h5><p class="pg-muted">Raised above the page, like a popover.</p></div>
        <div class="pg-card"><h5>Card with action</h5><p class="pg-muted">Upgrade to unlock exports.</p><button class="pg-btn pg-btn-primary pg-btn-sm" type="button" tabindex="-1">Upgrade</button></div>
        <div class="pg-card is-selected"><h5>Selected card ${icon.check}</h5><p>Highlighted with the soft primary tint.</p></div>
      </div>
    </section>

    <section class="pg-block">
      <h4 class="pg-block-title">Navigation</h4>
      <nav class="pg-nav"><span class="pg-brand">Acme</span><a class="is-active" href="#" tabindex="-1">Overview</a><a href="#" tabindex="-1">Projects</a><a href="#" tabindex="-1">Billing</a><span class="pg-spacer"></span><span class="pg-avatar">AJ</span></nav>
      <div class="pg-tabs" role="tablist"><span class="pg-tab is-active">Activity</span><span class="pg-tab">Members</span><span class="pg-tab">Settings</span></div>
      <p class="pg-breadcrumb"><a class="pg-link" href="#" tabindex="-1">Workspace</a> / <a class="pg-link" href="#" tabindex="-1">Projects</a> / <span aria-current="page">Brand refresh</span></p>
    </section>

    <section class="pg-block">
      <h4 class="pg-block-title">Status and feedback</h4>
      ${alert('success', 'Saved', 'Your changes are live.')}
      ${alert('warning', 'Storage almost full', 'You have used 92% of your quota.')}
      ${alert('error', 'Payment failed', 'Update your card to keep your plan.')}
      ${alert('info', 'New release', 'Version 2.4 adds team folders.')}
      <div class="pg-row">
        <span class="pg-badge pg-badge-success">Active</span>
        <span class="pg-badge pg-badge-warning">Pending</span>
        <span class="pg-badge pg-badge-error">Failed</span>
        <span class="pg-badge pg-badge-info">Beta</span>
        <span class="pg-badge pg-badge-primary">New</span>
        <span class="pg-pill"><span class="pg-dot"></span>All systems normal</span>
      </div>
    </section>

    <section class="pg-block pg-span-2">
      <h4 class="pg-block-title">Data</h4>
      ${table()}
    </section>

    <section class="pg-block pg-span-2">
      <h4 class="pg-block-title">Overlays</h4>
      <div class="pg-stage">
        <div class="pg-backdrop"></div>
        <div class="pg-modal" role="dialog" aria-label="Example dialog">
          <h5>Delete project?</h5>
          <p class="pg-muted">This removes 14 files. You can’t undo this.</p>
          <div class="pg-row pg-end"><button class="pg-btn pg-btn-ghost" type="button" tabindex="-1">Cancel</button><button class="pg-btn pg-btn-destructive" type="button" tabindex="-1">Delete</button></div>
        </div>
        <div class="pg-menu" role="menu" aria-label="Example menu">
          <span class="pg-menu-item">Rename</span>
          <span class="pg-menu-item is-hover">Duplicate</span>
          <span class="pg-menu-item">Share…</span>
          <hr>
          <span class="pg-menu-item pg-menu-danger">Delete</span>
        </div>
      </div>
    </section>
  </div>`;
}

function table(): SafeHtml {
  const rows = [
    ['INV-1042', 'Northwind', '£1,240.00', 'success', 'Paid'],
    ['INV-1043', 'Contoso', '£860.00', 'warning', 'Due'],
    ['INV-1044', 'Fabrikam', '£2,105.50', 'error', 'Overdue'],
    ['INV-1045', 'Tailspin', '£399.00', 'info', 'Draft'],
  ];
  return html`<div class="pg-table-wrap"><table class="pg-table">
    <thead><tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
    <tbody>${rows.map(
      ([id, who, amt, kind, label], i) =>
        html`<tr class="${i === 1 ? 'is-selected' : i === 2 ? 'is-hover' : ''}"><td>${id}</td><td>${who}</td><td>${amt}</td><td><span class="pg-badge pg-badge-${kind}">${label}</span></td></tr>`,
    )}</tbody></table>
    <div class="pg-pagination"><span class="pg-muted">Showing 1–4 of 38</span><span class="pg-spacer"></span><span class="pg-page">‹</span><span class="pg-page is-active">1</span><span class="pg-page">2</span><span class="pg-page">3</span><span class="pg-page">›</span></div></div>`;
}

function dashboard(): SafeHtml {
  const bars = [42, 58, 51, 74, 66, 88, 79];
  return html`<div class="pg-app">
    <aside class="pg-sidebar"><span class="pg-brand">Pulse</span><a class="is-active" href="#" tabindex="-1">Dashboard</a><a href="#" tabindex="-1">Customers</a><a href="#" tabindex="-1">Reports</a><a href="#" tabindex="-1">Settings</a></aside>
    <div class="pg-main">
      <div class="pg-row pg-between"><h2 class="pg-h2">Good morning, Aoife</h2><button class="pg-btn pg-btn-primary pg-btn-sm" type="button" tabindex="-1">New report</button></div>
      <div class="pg-stats">
        <div class="pg-card"><p class="pg-muted">Revenue</p><p class="pg-stat">£48.2k</p><span class="pg-badge pg-badge-success">+12%</span></div>
        <div class="pg-card"><p class="pg-muted">Active users</p><p class="pg-stat">3,912</p><span class="pg-badge pg-badge-info">+4%</span></div>
        <div class="pg-card"><p class="pg-muted">Churn</p><p class="pg-stat">2.1%</p><span class="pg-badge pg-badge-warning">+0.3%</span></div>
      </div>
      <div class="pg-card"><div class="pg-row pg-between"><h5>Weekly sign-ups</h5><div class="pg-tabs pg-tabs-sm"><span class="pg-tab is-active">7d</span><span class="pg-tab">30d</span></div></div>
        <div class="pg-chart">${bars.map((h, i) => html`<span style="height:${h}%" class="${i === 5 ? 'is-accent' : ''}"></span>`)}</div></div>
      ${table()}
    </div></div>`;
}

function landing(): SafeHtml {
  return html`<div class="pg-landing">
    <nav class="pg-nav pg-nav-plain"><span class="pg-brand">Lumen</span><span class="pg-spacer"></span><a href="#" tabindex="-1">Features</a><a href="#" tabindex="-1">Pricing</a><button class="pg-btn pg-btn-outline pg-btn-sm" type="button" tabindex="-1">Sign in</button></nav>
    <div class="pg-hero">
      <span class="pg-pill"><span class="pg-dot"></span>Now in public beta</span>
      <h1 class="pg-display">Plan, build and ship <span class="pg-accent-text">together</span></h1>
      <p class="pg-lead">One calm place for your roadmap, your docs and your releases.</p>
      <div class="pg-row pg-center"><button class="pg-btn pg-btn-primary" type="button" tabindex="-1">Start free</button><button class="pg-btn pg-btn-secondary" type="button" tabindex="-1">Book a demo</button></div>
    </div>
    <div class="pg-features">
      <div class="pg-card"><span class="pg-feature-icon">◆</span><h5>Roadmaps</h5><p class="pg-muted">Drag ideas into plans in seconds.</p></div>
      <div class="pg-card pg-card-elevated"><span class="pg-feature-icon is-accent">●</span><h5>Live docs</h5><p class="pg-muted">Specs that stay in sync with code.</p></div>
      <div class="pg-card"><span class="pg-feature-icon">▲</span><h5>Releases</h5><p class="pg-muted">Changelogs your customers read.</p></div>
    </div>
    <div class="pg-cta"><h3>Ready when you are.</h3><button class="pg-btn pg-btn-accent" type="button" tabindex="-1">Get started</button></div>
  </div>`;
}

function article(): SafeHtml {
  return html`<div class="pg-docs">
    <aside class="pg-toc"><p class="pg-label">Guides</p><a href="#" tabindex="-1">Introduction</a><a class="is-active" href="#" tabindex="-1">Authentication</a><a href="#" tabindex="-1">Webhooks</a><a href="#" tabindex="-1">Rate limits</a></aside>
    <article class="pg-article">
      <p class="pg-breadcrumb"><a class="pg-link" href="#" tabindex="-1">Docs</a> / Guides</p>
      <h1 class="pg-h1">Authentication</h1>
      <p class="pg-lead">Every request needs an API key sent in the <code class="pg-code">Authorization</code> header.</p>
      <p>Create keys from your <a class="pg-link" href="#" tabindex="-1">account settings</a>. Keys are shown once, so store them somewhere safe.</p>
      <pre class="pg-pre"><code>curl https://api.example.com/v1/items \\
  -H "Authorization: Bearer $API_KEY"</code></pre>
      ${alert('info', 'Tip', 'Use separate keys for staging and production.')}
      ${alert('warning', 'Careful', 'Never commit keys to source control.')}
      <h2 class="pg-h2">Scopes</h2>
      <table class="pg-table"><thead><tr><th>Scope</th><th>Allows</th></tr></thead><tbody><tr><td><code class="pg-code">read</code></td><td>Fetching resources</td></tr><tr><td><code class="pg-code">write</code></td><td>Creating and updating</td></tr></tbody></table>
    </article></div>`;
}

function mobile(): SafeHtml {
  return html`<div class="pg-phone-wrap"><div class="pg-phone">
    <div class="pg-phone-bar"><span>9:41</span><span>●●●</span></div>
    <div class="pg-phone-head"><h3>Today</h3><span class="pg-avatar">SK</span></div>
    <div class="pg-card is-selected"><p class="pg-label">Daily goal</p><p class="pg-stat">7,240 <span class="pg-muted">/ 10,000 steps</span></p><div class="pg-progress"><span style="width:72%"></span></div></div>
    <div class="pg-list">
      <div class="pg-list-item"><span class="pg-feature-icon">●</span><div><strong>Morning run</strong><p class="pg-muted">5.2 km · 28 min</p></div><span class="pg-badge pg-badge-success">Done</span></div>
      <div class="pg-list-item"><span class="pg-feature-icon is-accent">◆</span><div><strong>Yoga</strong><p class="pg-muted">18:30 · 45 min</p></div><span class="pg-badge pg-badge-warning">Later</span></div>
      <div class="pg-list-item"><span class="pg-feature-icon">▲</span><div><strong>Hydration</strong><p class="pg-muted">1.2 of 2 litres</p></div><span class="pg-badge pg-badge-info">Track</span></div>
    </div>
    <button class="pg-btn pg-btn-primary pg-btn-block" type="button" tabindex="-1">Log activity</button>
    <div class="pg-tabbar"><span class="is-active">Home</span><span>Plans</span><span>Stats</span><span>Me</span></div>
  </div></div>`;
}

/** Full playground: scene switcher + scenes inside a themed root. */
export function playground(initialMode: 'light' | 'dark' = 'light'): SafeHtml {
  return html`<div class="pg-shell" data-playground>
    <div class="pg-toolbar" role="tablist" aria-label="Preview scene">
      ${SCENES.map(([key, label], i) => html`<button type="button" role="tab" class="scene-tab${i === 0 ? ' is-active' : ''}" data-scene-tab="${key}" aria-selected="${i === 0 ? 'true' : 'false'}">${label}</button>`)}
    </div>
    <div class="pg-root" data-mode="${initialMode}" data-preview-root>
      <div class="pg-scene" data-scene="components">${components()}</div>
      <div class="pg-scene" data-scene="dashboard" hidden>${dashboard()}</div>
      <div class="pg-scene" data-scene="landing" hidden>${landing()}</div>
      <div class="pg-scene" data-scene="article" hidden>${article()}</div>
      <div class="pg-scene" data-scene="mobile" hidden>${mobile()}</div>
    </div>
  </div>`;
}
