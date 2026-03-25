<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "surface-container-low": "#1c1b1d",
              "primary-fixed-dim": "#ffb95f",
              "on-primary-fixed-variant": "#653e00",
              "on-secondary": "#472a00",
              "tertiary-container": "#1abdff",
              "on-surface": "#e5e1e4",
              "surface-container-highest": "#353437",
              "on-primary": "#472a00",
              "surface-container-high": "#2a2a2c",
              "error": "#ffb4ab",
              "tertiary-fixed": "#c5e7ff",
              "on-background": "#e5e1e4",
              "surface-variant": "#353437",
              "secondary-fixed-dim": "#f0bd82",
              "tertiary": "#8fd5ff",
              "on-secondary-fixed-variant": "#62400f",
              "surface-tint": "#ffb95f",
              "on-primary-container": "#613b00",
              "surface-bright": "#39393b",
              "inverse-surface": "#e5e1e4",
              "on-primary-fixed": "#2a1700",
              "on-secondary-container": "#ddac72",
              "on-tertiary-fixed-variant": "#004c6a",
              "tertiary-fixed-dim": "#7fd0ff",
              "outline-variant": "#534434",
              "on-secondary-fixed": "#2a1700",
              "secondary-fixed": "#ffddb8",
              "on-error": "#690005",
              "on-tertiary": "#00344a",
              "secondary": "#f0bd82",
              "secondary-container": "#62400f",
              "on-surface-variant": "#d8c3ad",
              "primary": "#ffc174",
              "inverse-on-surface": "#313032",
              "primary-fixed": "#ffddb8",
              "on-tertiary-fixed": "#001e2d",
              "surface": "#131315",
              "background": "#131315",
              "surface-container": "#201f22",
              "on-tertiary-container": "#004966",
              "outline": "#a08e7a",
              "surface-dim": "#131315",
              "error-container": "#93000a",
              "surface-container-lowest": "#0e0e10",
              "on-error-container": "#ffdad6",
              "primary-container": "#f59e0b",
              "inverse-primary": "#855300"
            },
            fontFamily: {
              "headline": ["Plus Jakarta Sans"],
              "body": ["Plus Jakarta Sans"],
              "label": ["Plus Jakarta Sans"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; }
        .glass-panel { backdrop-filter: blur(20px); background: rgba(32, 31, 34, 0.6); }
        .amber-gradient { background: linear-gradient(135deg, #FFC174 0%, #F59E0B 100%); }
    </style>
</head>
<body class="bg-surface text-on-surface font-body antialiased">
<!-- TopNavBar -->
<header class="fixed top-0 w-full h-14 z-50 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-xl font-['Plus_Jakarta_Sans'] antialiased text-sm tracking-tight">
<div class="flex justify-between items-center px-6 w-full h-full">
<div class="flex items-center gap-4">
<span class="text-xl font-bold tracking-tighter text-zinc-900 dark:text-zinc-50">Silas Prism</span>
</div>
<div class="flex items-center gap-6">
<div class="hidden md:flex gap-4">
<span class="text-amber-600 dark:text-amber-400 font-semibold cursor-pointer">Dashboard</span>
<span class="text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-200 px-2 py-1 rounded cursor-pointer">Intelligence</span>
<span class="text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-200 px-2 py-1 rounded cursor-pointer">Generate</span>
</div>
<div class="flex items-center gap-3">
<button class="p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-full transition-all">
<span class="material-symbols-outlined">notifications</span>
</button>
<div class="h-8 w-8 rounded-full bg-surface-container-highest overflow-hidden border border-outline-variant/20">
<img alt="User Profile" data-alt="User profile picture" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBtAphDS67xjAt5V_2LuBCyHUk-FAc-lKTx_E1gSlYL9NDBkpC3mcUOF4q0Do6AS-K4jWIe1bTNXJvdzynZidJBsn6jNjoFCpNRQPQkeV-7rJjerhUi5O_bqQqfMT3CXZ1h2knDL3iYQgONv9FvbBkmVmLrKM5xdkP2q0Jnv8Dns55cRA8gIkb7xBBSDMdCfTORvGQb1EcAIxGaUovTh3wyXYeIJrzlkTBRfMEpDORLCC8fjCUnBtdX3f2jU-UD1XMNp2uEOYJmVdnl"/>
</div>
</div>
</div>
</div>
<div class="bg-zinc-200/50 dark:bg-zinc-800/50 h-[1px] w-full absolute bottom-0"></div>
</header>
<!-- SideNavBar -->
<aside class="fixed left-0 top-0 h-full flex flex-col py-6 px-4 z-40 bg-zinc-50 dark:bg-zinc-950 h-screen w-[220px] border-r border-zinc-200/20 dark:border-zinc-800/20 hidden md:flex">
<div class="mb-10 mt-12 flex items-center gap-3 px-2">
<div class="h-8 w-8 amber-gradient rounded-lg flex items-center justify-center text-on-primary">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
</div>
<div>
<div class="text-lg font-extrabold text-zinc-900 dark:text-zinc-50 leading-none">Silas Prism</div>
<div class="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Content Automation</div>
</div>
</div>
<nav class="flex-1 space-y-1">
<a class="flex items-center gap-3 px-4 py-2 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">dashboard</span>
                Dashboard
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">insights</span>
                Intelligence
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">auto_awesome</span>
                Generate
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">calendar_today</span>
                Scheduling
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">database</span>
                Context
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px] hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined">settings</span>
                Settings
            </a>
</nav>
<div class="mt-auto pt-6 border-t border-zinc-200/20 dark:border-zinc-800/20">
<button class="w-full amber-gradient text-on-primary font-bold py-2.5 rounded-xl text-[13px] mb-4 shadow-lg shadow-amber-500/10">
                New Project
            </button>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all font-medium text-[13px]" href="#">
<span class="material-symbols-outlined">group</span>
                Client Selector
            </a>
</div>
</aside>
<!-- Main Content Canvas -->
<main class="md:pl-[220px] pt-14 min-h-screen bg-surface-container-lowest">
<div class="max-w-7xl mx-auto px-6 py-8">
<!-- Hero Header -->
<header class="mb-10 flex justify-between items-end">
<div class="space-y-1">
<h1 class="text-4xl font-extrabold tracking-tight text-on-surface">System Overview</h1>
<p class="text-on-surface-variant text-sm max-w-md">Real-time automation health and content generation orchestration.</p>
</div>
<div class="flex gap-3">
<div class="px-4 py-2 bg-surface-container rounded-lg border border-outline-variant/10 text-xs font-medium text-on-surface-variant flex items-center gap-2">
<span class="w-2 h-2 rounded-full bg-green-500"></span>
                        API Active
                    </div>
</div>
</header>
<!-- Attention Banner -->
<div class="mb-8 p-4 bg-primary-container/10 border border-primary-container/20 rounded-2xl flex items-center justify-between glass-panel">
<div class="flex items-center gap-4">
<div class="bg-primary-container text-on-primary-container p-2 rounded-xl">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">priority_high</span>
</div>
<div>
<h3 class="font-bold text-primary-fixed-dim">Review Required</h3>
<p class="text-sm text-on-surface-variant">There are <span class="text-on-surface font-semibold">3 reviews</span> pending your final approval before publication.</p>
</div>
</div>
<button class="px-6 py-2 bg-primary-container text-on-primary-container font-bold rounded-lg text-sm">
                    Open Queue
                </button>
</div>
<!-- Bento Grid Stats -->
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
<!-- Metrics Card 1 -->
<div class="surface-container rounded-3xl p-6 relative overflow-hidden group">
<div class="absolute top-0 right-0 w-32 h-32 amber-gradient opacity-5 blur-3xl group-hover:opacity-10 transition-opacity"></div>
<div class="flex justify-between items-start mb-4">
<span class="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Scrape Efficiency</span>
<span class="text-on-surface-variant text-[10px]">2h ago</span>
</div>
<div class="flex items-baseline gap-2">
<span class="text-5xl font-extrabold tracking-tighter text-on-surface">94.2%</span>
<span class="text-green-400 text-xs font-bold">+2.4%</span>
</div>
<div class="mt-6 flex items-center gap-2">
<span class="material-symbols-outlined text-amber-500 text-sm">check_circle</span>
<span class="text-xs text-on-surface-variant">12,402 sources indexed successfully</span>
</div>
</div>
<!-- Metrics Card 2 -->
<div class="surface-container rounded-3xl p-6 relative overflow-hidden group">
<div class="absolute top-0 right-0 w-32 h-32 bg-tertiary opacity-5 blur-3xl group-hover:opacity-10 transition-opacity"></div>
<div class="flex justify-between items-start mb-4">
<span class="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Generation Speed</span>
<span class="text-on-surface-variant text-[10px]">5h ago</span>
</div>
<div class="flex items-baseline gap-2">
<span class="text-5xl font-extrabold tracking-tighter text-on-surface">1.8s</span>
<span class="text-amber-400 text-xs font-bold">Optimal</span>
</div>
<div class="mt-6 flex items-center gap-2">
<span class="material-symbols-outlined text-tertiary text-sm">bolt</span>
<span class="text-xs text-on-surface-variant">Average latent response for GPT-4o cluster</span>
</div>
</div>
<!-- Metrics Card 3 -->
<div class="surface-container rounded-3xl p-6 relative overflow-hidden group">
<div class="flex justify-between items-start mb-4">
<span class="text-on-surface-variant text-xs font-bold uppercase tracking-widest">Active Credits</span>
<span class="text-on-surface-variant text-[10px]">Live</span>
</div>
<div class="flex items-baseline gap-2">
<span class="text-5xl font-extrabold tracking-tighter text-on-surface">42.8k</span>
</div>
<div class="mt-6">
<div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
<div class="bg-amber-500 h-full w-3/4"></div>
</div>
<div class="flex justify-between mt-2">
<span class="text-[10px] text-on-surface-variant uppercase">Current Usage</span>
<span class="text-[10px] text-on-surface-variant">75% of limit</span>
</div>
</div>
</div>
</div>
<!-- Two Column Layout: Feed and Trends -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
<!-- Recent Activity Feed -->
<div class="lg:col-span-2 space-y-6">
<div class="flex items-center justify-between">
<h2 class="text-xl font-bold">Recent Activity</h2>
<button class="text-amber-500 text-sm font-semibold hover:underline">Export Logs</button>
</div>
<div class="space-y-1">
<!-- Activity Item 1 -->
<div class="bg-surface-container p-4 rounded-2xl flex gap-4 items-start hover:bg-surface-container-high transition-colors">
<div class="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-amber-500 flex-shrink-0">
<span class="material-symbols-outlined">description</span>
</div>
<div class="flex-1">
<div class="flex justify-between">
<h4 class="font-bold text-sm text-on-surface">Draft Generated: "Sustainable Tech 2024"</h4>
<span class="text-[10px] text-on-surface-variant">12 mins ago</span>
</div>
<p class="text-xs text-on-surface-variant mt-1">Intelligence agent matched 14 data points with the current context library.</p>
<div class="mt-3 flex gap-2">
<span class="px-2 py-0.5 rounded bg-surface-container-highest text-[10px] font-bold text-amber-500">PENDING REVIEW</span>
<span class="px-2 py-0.5 rounded bg-surface-container-highest text-[10px] font-bold text-on-surface-variant">AGENT_04</span>
</div>
</div>
</div>
<!-- Activity Item 2 -->
<div class="bg-surface-container p-4 rounded-2xl flex gap-4 items-start hover:bg-surface-container-high transition-colors">
<div class="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-blue-400 flex-shrink-0">
<span class="material-symbols-outlined">cloud_download</span>
</div>
<div class="flex-1">
<div class="flex justify-between">
<h4 class="font-bold text-sm text-on-surface">Data Scrape Completed</h4>
<span class="text-[10px] text-on-surface-variant">1 hour ago</span>
</div>
<p class="text-xs text-on-surface-variant mt-1">Successfully crawled 8 target domains. 1.2k new entries added to Context.</p>
<div class="mt-3 flex gap-2">
<span class="px-2 py-0.5 rounded bg-surface-container-highest text-[10px] font-bold text-green-400">SUCCESS</span>
</div>
</div>
</div>
<!-- Activity Item 3 -->
<div class="bg-surface-container p-4 rounded-2xl flex gap-4 items-start hover:bg-surface-container-high transition-colors">
<div class="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-red-400 flex-shrink-0">
<span class="material-symbols-outlined">warning</span>
</div>
<div class="flex-1">
<div class="flex justify-between">
<h4 class="font-bold text-sm text-on-surface">Prompt Rejection</h4>
<span class="text-[10px] text-on-surface-variant">3 hours ago</span>
</div>
<p class="text-xs text-on-surface-variant mt-1">Conflict detected between Brand Guidelines and Request #882. Generation halted.</p>
<div class="mt-3 flex gap-2">
<span class="px-2 py-0.5 rounded bg-surface-container-highest text-[10px] font-bold text-red-400">BLOCKED</span>
<button class="text-[10px] font-bold text-amber-500 underline ml-auto">VIEW CONFLICT</button>
</div>
</div>
</div>
</div>
</div>
<!-- Contextual Sidebar in Main -->
<div class="space-y-6">
<h2 class="text-xl font-bold">Intelligence Context</h2>
<div class="surface-container rounded-3xl p-6 space-y-6 border border-outline-variant/5">
<div class="space-y-2">
<label class="text-[10px] font-extrabold text-on-surface-variant uppercase tracking-widest">Active Focus</label>
<div class="flex flex-wrap gap-2">
<span class="px-3 py-1 bg-surface-container-highest rounded-full text-xs border border-amber-500/20 text-on-surface">FinTech</span>
<span class="px-3 py-1 bg-surface-container-highest rounded-full text-xs border border-outline-variant/10 text-on-surface-variant">SaaS Patterns</span>
<span class="px-3 py-1 bg-surface-container-highest rounded-full text-xs border border-outline-variant/10 text-on-surface-variant">AI Ethics</span>
</div>
</div>
<div class="space-y-4">
<label class="text-[10px] font-extrabold text-on-surface-variant uppercase tracking-widest">Knowledge Clusters</label>
<div class="flex items-center gap-4">
<div class="w-1.5 h-12 bg-amber-500 rounded-full"></div>
<div>
<div class="text-sm font-bold">Marketing Automation</div>
<div class="text-[10px] text-on-surface-variant">8,421 Related Entities</div>
</div>
</div>
<div class="flex items-center gap-4">
<div class="w-1.5 h-12 bg-zinc-700 rounded-full"></div>
<div>
<div class="text-sm font-bold">Global Logistics</div>
<div class="text-[10px] text-on-surface-variant">2,109 Related Entities</div>
</div>
</div>
</div>
<button class="w-full py-3 bg-surface-container-high rounded-xl text-sm font-bold hover:bg-surface-bright transition-colors border border-outline-variant/10">
                            Update Context Library
                        </button>
</div>
<!-- Small "Pro" CTA -->
<div class="amber-gradient rounded-3xl p-6 text-on-primary relative overflow-hidden">
<span class="material-symbols-outlined absolute -bottom-4 -right-4 text-8xl opacity-10" style="font-variation-settings: 'FILL' 1;">auto_fix_high</span>
<h4 class="text-lg font-extrabold leading-tight mb-2">Unlock Advanced Models</h4>
<p class="text-xs opacity-90 mb-4">Integrate Claude 3.5 Sonnet and custom GPT fine-tunes into your workflow.</p>
<button class="bg-white/20 backdrop-blur-md px-4 py-2 rounded-lg text-xs font-bold hover:bg-white/30 transition-all">
                            Upgrade Now
                        </button>
</div>
</div>
</div>
</div>
</main>
</body></html>


<!-- Generate — Hooks (Prism) -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Silas Prism - Generate Hooks</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "surface-container-low": "#1c1b1d",
              "primary-fixed-dim": "#ffb95f",
              "on-primary-fixed-variant": "#653e00",
              "on-secondary": "#472a00",
              "tertiary-container": "#1abdff",
              "on-surface": "#e5e1e4",
              "surface-container-highest": "#353437",
              "on-primary": "#472a00",
              "surface-container-high": "#2a2a2c",
              "error": "#ffb4ab",
              "tertiary-fixed": "#c5e7ff",
              "on-background": "#e5e1e4",
              "surface-variant": "#353437",
              "secondary-fixed-dim": "#f0bd82",
              "tertiary": "#8fd5ff",
              "on-secondary-fixed-variant": "#62400f",
              "surface-tint": "#ffb95f",
              "on-primary-container": "#613b00",
              "surface-bright": "#39393b",
              "inverse-surface": "#e5e1e4",
              "on-primary-fixed": "#2a1700",
              "on-secondary-container": "#ddac72",
              "on-tertiary-fixed-variant": "#004c6a",
              "tertiary-fixed-dim": "#7fd0ff",
              "outline-variant": "#534434",
              "on-secondary-fixed": "#2a1700",
              "secondary-fixed": "#ffddb8",
              "on-error": "#690005",
              "on-tertiary": "#00344a",
              "secondary": "#f0bd82",
              "secondary-container": "#62400f",
              "on-surface-variant": "#d8c3ad",
              "primary": "#ffc174",
              "inverse-on-surface": "#313032",
              "primary-fixed": "#ffddb8",
              "on-tertiary-fixed": "#001e2d",
              "surface": "#131315",
              "background": "#131315",
              "surface-container": "#201f22",
              "on-tertiary-container": "#004966",
              "outline": "#a08e7a",
              "surface-dim": "#131315",
              "error-container": "#93000a",
              "surface-container-lowest": "#0e0e10",
              "on-error-container": "#ffdad6",
              "primary-container": "#f59e0b",
              "inverse-primary": "#855300"
            },
            fontFamily: {
              "headline": ["Plus Jakarta Sans"],
              "body": ["Plus Jakarta Sans"],
              "label": ["Plus Jakarta Sans"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .glass-card {
            background: rgba(53, 52, 55, 0.4);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
        }
    </style>
</head>
<body class="bg-surface text-on-surface antialiased">
<!-- TopNavBar (Shared Component) -->
<nav class="fixed top-0 w-full h-14 z-50 bg-zinc-950/80 backdrop-blur-xl flex justify-between items-center px-6">
<div class="flex items-center gap-4">
<span class="text-xl font-bold tracking-tighter text-zinc-50">Silas Prism</span>
</div>
<div class="flex items-center gap-6">
<div class="hidden md:flex items-center gap-8 text-sm font-['Plus_Jakarta_Sans'] tracking-tight">
<a class="text-zinc-500 hover:text-amber-400 transition-colors" href="#">Dashboard</a>
<a class="text-zinc-500 hover:text-amber-400 transition-colors" href="#">Intelligence</a>
<a class="text-amber-400 font-semibold" href="#">Generate</a>
</div>
<div class="flex items-center gap-4">
<button class="p-2 text-zinc-400 hover:bg-zinc-900 rounded-lg transition-colors">
<span class="material-symbols-outlined">notifications</span>
</button>
<div class="h-8 w-8 rounded-full overflow-hidden border border-zinc-800">
<img alt="User Profile" data-alt="User profile avatar circle" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRzWuRo182qdRpqfAo_Sa-T1oEcu6gzjIAfv8pGW5_sxwNFWuhUygT1WYOL0BrvCpaw8Ef8pJst3UqxYj-InowB23KMiG4MUbe-uO6EjrqcUZsAxvlMJQVGrUKrR2v8QVwmBkRNbYeHHyb_X_yr2xFP5TliFk7H3hn82wBH-fBiSDh075Y-HtwF4djFISW_1f3nJDj97Wf983m73B3JmqrE7iUYy2TjVlKGea-vQsWypkwFBBWciLoWEGZ7TVTCVQfdcuuZKwtpeZF"/>
</div>
</div>
</div>
<div class="bg-zinc-800/50 h-[1px] w-full absolute bottom-0 left-0"></div>
</nav>
<!-- SideNavBar (Shared Component) -->
<aside class="fixed left-0 top-0 h-full w-[220px] hidden md:flex flex-col py-6 px-4 z-40 bg-zinc-950 border-r border-zinc-800/20">
<div class="pt-14 pb-8">
<div class="flex items-center gap-3 px-2">
<div class="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center">
<span class="material-symbols-outlined text-on-primary-container" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
</div>
<div>
<h2 class="text-lg font-extrabold text-zinc-50 leading-tight">Silas Prism</h2>
<p class="text-[11px] text-zinc-500 font-medium">Content Automation</p>
</div>
</div>
</div>
<nav class="flex flex-col gap-1 flex-1">
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 hover:translate-x-1 transition-all rounded-lg text-[13px] font-medium" href="#">
<span class="material-symbols-outlined">dashboard</span> Dashboard
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 hover:translate-x-1 transition-all rounded-lg text-[13px] font-medium" href="#">
<span class="material-symbols-outlined">insights</span> Intelligence
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-amber-400 bg-amber-900/10 rounded-lg text-[13px] font-medium translate-x-1" href="#">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">auto_awesome</span> Generate
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 hover:translate-x-1 transition-all rounded-lg text-[13px] font-medium" href="#">
<span class="material-symbols-outlined">calendar_today</span> Scheduling
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 hover:translate-x-1 transition-all rounded-lg text-[13px] font-medium" href="#">
<span class="material-symbols-outlined">database</span> Context
            </a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 hover:translate-x-1 transition-all rounded-lg text-[13px] font-medium" href="#">
<span class="material-symbols-outlined">settings</span> Settings
            </a>
</nav>
<div class="mt-auto pt-6">
<button class="w-full bg-primary-container text-on-primary-container py-2.5 rounded-lg text-[13px] font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all">
<span class="material-symbols-outlined text-sm">add</span> New Project
            </button>
<div class="mt-4 flex items-center gap-3 px-4 py-2 text-zinc-500 hover:bg-zinc-900 rounded-lg text-[13px] font-medium cursor-pointer">
<span class="material-symbols-outlined">group</span> Client Selector
            </div>
</div>
</aside>
<!-- Main Content Canvas -->
<main class="md:ml-[220px] pt-14 min-h-screen">
<div class="max-w-[1400px] mx-auto p-8 md:p-12">
<!-- Header Section: Editorial Asymmetry -->
<header class="mb-16">
<span class="text-primary font-bold tracking-widest text-[10px] uppercase mb-2 block">Content Engine v2.0</span>
<h1 class="text-5xl md:text-6xl font-headline font-extrabold tracking-tighter text-zinc-50 mb-4 max-w-2xl leading-[1.1]">
                    Hook Architecture.
                </h1>
<p class="text-zinc-500 max-w-lg leading-relaxed text-lg">
                    Transforming core concepts into high-retention opening lines. Generate, refine, and deploy across all channels.
                </p>
</header>
<div class="flex flex-col lg:flex-row gap-12 items-start">
<!-- Left Panel: Generation Controls -->
<section class="w-full lg:w-[400px] sticky top-24 space-y-10">
<div class="space-y-6">
<div class="space-y-2">
<label class="text-xs font-bold text-zinc-400 uppercase tracking-widest ml-1">Content Niche</label>
<div class="relative">
<select class="w-full bg-surface-container-high border-none rounded-xl py-4 px-5 text-on-surface appearance-none focus:ring-1 focus:ring-primary/20 transition-all">
<option>B2B SaaS Growth</option>
<option>Personal Finance</option>
<option>Creative Technology</option>
<option>Performance Marketing</option>
<option>Lifestyle &amp; Wellness</option>
</select>
<span class="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">expand_more</span>
</div>
</div>
<div class="space-y-4">
<label class="text-xs font-bold text-zinc-400 uppercase tracking-widest ml-1">Tone &amp; Voice</label>
<div class="grid grid-cols-2 gap-3">
<button class="flex items-center gap-3 p-4 rounded-xl bg-surface-container-high border border-primary/20 text-primary transition-all">
<span class="material-symbols-outlined text-sm">bolt</span>
<span class="text-sm font-semibold">Authoritative</span>
</button>
<button class="flex items-center gap-3 p-4 rounded-xl bg-surface-container-low text-zinc-400 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-sm">psychology</span>
<span class="text-sm font-semibold">Curious</span>
</button>
<button class="flex items-center gap-3 p-4 rounded-xl bg-surface-container-low text-zinc-400 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-sm">warning</span>
<span class="text-sm font-semibold">Urgent</span>
</button>
<button class="flex items-center gap-3 p-4 rounded-xl bg-surface-container-low text-zinc-400 hover:bg-surface-container-high transition-all">
<span class="material-symbols-outlined text-sm">forum</span>
<span class="text-sm font-semibold">Conversational</span>
</button>
</div>
</div>
<div class="space-y-2">
<label class="text-xs font-bold text-zinc-400 uppercase tracking-widest ml-1">Context / Topic</label>
<textarea class="w-full bg-surface-container-high border-none rounded-xl p-5 text-on-surface placeholder:text-zinc-600 focus:ring-1 focus:ring-primary/20 transition-all" placeholder="What is this content about?" rows="4"></textarea>
</div>
</div>
<button class="w-full py-5 bg-primary-container text-on-primary-container font-extrabold text-sm uppercase tracking-[0.2em] rounded-xl flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-amber-900/10">
                        Generate Hooks <span class="material-symbols-outlined">auto_awesome</span>
</button>
<!-- Status Indicator -->
<div class="flex items-center gap-3 px-2">
<div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
<span class="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">System ready for inference</span>
</div>
</section>
<!-- Right Panel: The Hook Gallery -->
<section class="flex-1 w-full space-y-6">
<div class="flex items-center justify-between mb-8 pb-4 border-b border-zinc-800/20">
<h3 class="text-sm font-bold text-zinc-400 uppercase tracking-[0.2em]">Generated Output (10)</h3>
<div class="flex gap-2">
<button class="px-4 py-2 bg-surface-container-high rounded-full text-[11px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors">EXPORT ALL</button>
<button class="px-4 py-2 bg-surface-container-high rounded-full text-[11px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors">REFRESH</button>
</div>
</div>
<!-- Hook List: Tonal Layering (No Borders) -->
<div class="grid grid-cols-1 gap-4">
<!-- Hook Card 1 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                Stop wasting hours on manual formatting when these 3 automation secrets can do it for you in seconds.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 2 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                Most founders fail because they ignore this one critical metric in their first six months of operation.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 3 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                Why your current content strategy is actually driving your best customers straight to your competitors.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 4 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                I analyzed 500 viral posts and discovered the exact psychological trigger that forces people to comment.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 5 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                This hidden AI tool is doing the work of an entire marketing department for less than the cost of a coffee.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 6 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                If you want to scale your revenue to 10k a month, you need to stop doing these 5 low-value tasks today.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 7 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                The real reason your organic reach has plummeted, and the simple fix that no one is talking about yet.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 8 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                How I built a six-figure consulting business without ever spending a single dollar on digital advertising.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 9 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                Your pitch deck is likely missing this one slide that every serious investor looks for immediately.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
<!-- Hook Card 10 -->
<div class="glass-card group p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 transition-all hover:bg-surface-container-high">
<p class="text-zinc-200 text-[15px] leading-relaxed flex-1 font-normal">
                                Here is the exact framework I use to write LinkedIn posts that generate over 100 inbound leads per month.
                            </p>
<div class="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-primary transition-colors" title="Copy">
<span class="material-symbols-outlined text-[20px]">content_copy</span>
</button>
<button class="p-2.5 rounded-lg bg-surface-container-highest text-zinc-400 hover:text-amber-400 transition-colors" title="Save">
<span class="material-symbols-outlined text-[20px]">star</span>
</button>
<button class="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-container/10 text-primary text-[12px] font-bold hover:bg-primary-container/20 transition-all">
                                    USE IN SCRIPT <span class="material-symbols-outlined text-sm">arrow_forward</span>
</button>
</div>
</div>
</div>
<!-- Pagination / Load More (Editorial Style) -->
<div class="pt-12 flex justify-center">
<button class="flex flex-col items-center gap-2 group">
<span class="text-[10px] font-bold text-zinc-500 tracking-[0.3em] uppercase group-hover:text-primary transition-colors">Load More Architectures</span>
<span class="material-symbols-outlined text-zinc-700 group-hover:text-primary transition-colors">keyboard_double_arrow_down</span>
</button>
</div>
</section>
</div>
</div>
</main>
<!-- Invisible Canvas Overlay for Ambient Glow -->
<div class="fixed top-0 right-0 -z-10 w-[500px] h-[500px] bg-primary/5 blur-[120px] rounded-full pointer-events-none"></div>
<div class="fixed bottom-0 left-0 -z-10 w-[300px] h-[300px] bg-primary/5 blur-[100px] rounded-full pointer-events-none"></div>
</body></html>

<!-- Intelligence — Viral Feed (Prism) -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Intelligence — Viral Feed | Silas Prism</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "surface-container-low": "#1c1b1d",
              "primary-fixed-dim": "#ffb95f",
              "on-primary-fixed-variant": "#653e00",
              "on-secondary": "#472a00",
              "tertiary-container": "#1abdff",
              "on-surface": "#e5e1e4",
              "surface-container-highest": "#353437",
              "on-primary": "#472a00",
              "surface-container-high": "#2a2a2c",
              "error": "#ffb4ab",
              "tertiary-fixed": "#c5e7ff",
              "on-background": "#e5e1e4",
              "surface-variant": "#353437",
              "secondary-fixed-dim": "#f0bd82",
              "tertiary": "#8fd5ff",
              "on-secondary-fixed-variant": "#62400f",
              "surface-tint": "#ffb95f",
              "on-primary-container": "#613b00",
              "surface-bright": "#39393b",
              "inverse-surface": "#e5e1e4",
              "on-primary-fixed": "#2a1700",
              "on-secondary-container": "#ddac72",
              "on-tertiary-fixed-variant": "#004c6a",
              "tertiary-fixed-dim": "#7fd0ff",
              "outline-variant": "#534434",
              "on-secondary-fixed": "#2a1700",
              "secondary-fixed": "#ffddb8",
              "on-error": "#690005",
              "on-tertiary": "#00344a",
              "secondary": "#f0bd82",
              "secondary-container": "#62400f",
              "on-surface-variant": "#d8c3ad",
              "primary": "#ffc174",
              "inverse-on-surface": "#313032",
              "primary-fixed": "#ffddb8",
              "on-tertiary-fixed": "#001e2d",
              "surface": "#131315",
              "background": "#131315",
              "surface-container": "#201f22",
              "on-tertiary-container": "#004966",
              "outline": "#a08e7a",
              "surface-dim": "#131315",
              "error-container": "#93000a",
              "surface-container-lowest": "#0e0e10",
              "on-error-container": "#ffdad6",
              "primary-container": "#f59e0b",
              "inverse-primary": "#855300"
            },
            fontFamily: {
              "headline": ["Plus Jakarta Sans"],
              "body": ["Plus Jakarta Sans"],
              "label": ["Plus Jakarta Sans"]
            },
            borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
          },
        },
      }
    </script>
<style>
        body { font-family: 'Plus Jakarta Sans', sans-serif; }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
    </style>
</head>
<body class="bg-background text-on-background antialiased">
<!-- SideNavBar Shell -->
<aside class="fixed left-0 top-0 h-full flex flex-col py-6 px-4 z-40 bg-zinc-50 dark:bg-zinc-950 h-screen w-[220px] border-r border-zinc-200/20 dark:border-zinc-800/20 font-['Plus_Jakarta_Sans'] font-medium text-[13px]">
<div class="flex items-center gap-3 mb-10 px-2">
<div class="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center">
<span class="material-symbols-outlined text-on-primary-container" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
</div>
<div>
<h1 class="text-lg font-extrabold text-zinc-900 dark:text-zinc-50 leading-none">Silas Prism</h1>
<p class="text-[10px] text-zinc-500 uppercase tracking-widest mt-1">Content Automation</p>
</div>
</div>
<nav class="flex-1 space-y-1">
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all hover:translate-x-1 duration-200" href="#">
<span class="material-symbols-outlined">dashboard</span>
<span>Dashboard</span>
</a>
<a class="flex items-center gap-3 px-4 py-2 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10 rounded-lg hover:translate-x-1 transition-transform duration-200" href="#">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">insights</span>
<span>Intelligence</span>
</a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all hover:translate-x-1 duration-200" href="#">
<span class="material-symbols-outlined">auto_awesome</span>
<span>Generate</span>
</a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all hover:translate-x-1 duration-200" href="#">
<span class="material-symbols-outlined">calendar_today</span>
<span>Scheduling</span>
</a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all hover:translate-x-1 duration-200" href="#">
<span class="material-symbols-outlined">database</span>
<span>Context</span>
</a>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all hover:translate-x-1 duration-200" href="#">
<span class="material-symbols-outlined">settings</span>
<span>Settings</span>
</a>
</nav>
<div class="mt-auto pt-6 border-t border-zinc-800/10">
<button class="w-full bg-primary-container text-on-primary-container py-2.5 rounded-lg font-bold flex items-center justify-center gap-2 mb-6">
<span class="material-symbols-outlined text-sm">add</span>
                New Project
            </button>
<a class="flex items-center gap-3 px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg transition-all" href="#">
<span class="material-symbols-outlined">group</span>
<span>Client Selector</span>
</a>
</div>
</aside>
<!-- Main Content Canvas -->
<main class="ml-[220px] min-h-screen p-12">
<!-- Header Section -->
<header class="mb-16">
<div class="flex justify-between items-end">
<div>
<nav class="flex items-center gap-2 text-xs text-zinc-500 mb-4 tracking-wider uppercase font-semibold">
<span>Intelligence</span>
<span class="material-symbols-outlined text-[10px]">chevron_right</span>
<span class="text-primary">Viral Feed</span>
</nav>
<h2 class="text-6xl font-extrabold tracking-tighter text-on-surface leading-none">The Luminous Feed.</h2>
</div>
<div class="flex gap-4">
<div class="bg-surface-container-high px-4 py-2 rounded-lg flex items-center gap-3">
<span class="text-xs text-zinc-500 font-medium">Outlier Threshold</span>
<span class="text-primary font-bold">3.5x</span>
</div>
<button class="bg-surface-bright px-6 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 border border-outline-variant/10">
<span class="material-symbols-outlined text-sm">filter_list</span>
                        Refine Signal
                    </button>
</div>
</div>
</header>
<!-- Intelligence Bento Grid -->
<section class="grid grid-cols-12 gap-6 mb-12">
<!-- Featured Reel Mockup -->
<div class="col-span-4 bg-surface-container rounded-xl overflow-hidden relative group">
<div class="aspect-[9/16] bg-zinc-900 relative">
<img class="w-full h-full object-cover opacity-60" data-alt="Social media reel preview showing abstract light patterns" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCVHRlC1M24rc2g0Bn-Vm0IpkNy97krpoeWZXk7Emnh9CNYH8LfPDwpGq0RcY8NdxTuOdJht1gnSk7c6oU85HLojklYZySijtDRNADcDOzY-uJCxWT8xgocNw7eltt0_8eCxmJA7aJch_78tPYyN14mRWzkuH9oup1PiTrJ1CeUy3f2r_AoqasyrPzIibBEkLw4LPmfA64kzoXSo2igH6UePU3nx-H-otg4Z0XfdnlqohSdxONfVjV-rP9gUohVLMimpLnxu-O3ht9P"/>
<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
<!-- Mockup Overlay -->
<div class="absolute inset-x-4 bottom-6 space-y-3">
<div class="flex items-center gap-2">
<div class="w-8 h-8 rounded-full bg-zinc-400 border border-white/20 overflow-hidden">
<img alt="Profile" data-alt="User avatar for profile thumbnail" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBs6CeSyQsshmhGlZMwP88rT91bqwv04_e-jPWSZRxeT94RQrhStWM-MENN3MU_ApjPDxYs-AKfavNAbtV005X_0UJRPlWlir0_qjXuXNuKFcWVdFfTTd0nUIZnxOGNC1rq3AUei7w3WnMWhKlXzALnYVZHcbmEfKoOEwQCHLAm70ebxMmwcZE6RHkG_zYufJIybic4BbVe7AH5M4TVE-Hu5N6K2vZY6vY_-FVshpjrQBo27hTeU_0dgNmcCKc6MfWvIGE0UAFW-9xg"/>
</div>
<span class="text-xs font-bold text-white">@neuro_growth</span>
</div>
<p class="text-xs text-white/90 line-clamp-2">The psychological reason your hooks are failing in the first 0.5 seconds of viewing...</p>
<div class="flex gap-3 text-[10px] text-white/60">
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">favorite</span> 42.1k</span>
<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">chat_bubble</span> 1.2k</span>
</div>
</div>
</div>
<!-- Analysis Badge -->
<div class="absolute top-4 right-4 bg-primary-container/90 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-extrabold text-on-primary-container">
                    OUTLIER: 8.4X
                </div>
</div>
<!-- Viral Feed Intelligence Table -->
<div class="col-span-8 space-y-6">
<div class="bg-surface-container rounded-xl p-8">
<div class="flex items-center justify-between mb-8">
<h3 class="text-xl font-bold tracking-tight">Emerging Patterns</h3>
<div class="flex gap-2">
<span class="px-3 py-1 bg-surface-container-high rounded-full text-[10px] text-zinc-400 uppercase tracking-widest font-bold">24H Window</span>
</div>
</div>
<div class="space-y-4">
<!-- Table Row 1 -->
<div class="grid grid-cols-12 items-center p-4 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors group cursor-pointer">
<div class="col-span-5 flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
<img alt="Preview" data-alt="Minimalist technology setup thumbnail" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA41Zy_xJm1DAPn9PC6aROKJP0rI935PCaZMjdVxEAcNm8IxFzFrkxZBX2r0FGscJ8SJnZCJB8gCgO7aARREYdQqiAZwuFFWZ6CqDP0hgYjIyiyf6oWOnYcRkNPVF5XJP92vrsv6C8esJfjdEtNQoYl4ct-3cLLlwnzefIJwgdez_PpSYo5BrGEMivgAJ66jD-8ORe4tsV0MEBgVNLDVURq8M838trE4W6zV7l-fcKNKuGxW7-b6NbLsZ2gwtnG3f_C9lHVxkhyZvk_"/>
</div>
<div>
<p class="text-[11px] text-zinc-500 uppercase font-bold tracking-tighter">Hook Alpha</p>
<h4 class="text-sm font-semibold text-on-surface">"Stop building features, start..."</h4>
</div>
</div>
<div class="col-span-2 text-center">
<p class="text-[10px] text-zinc-500 mb-1">Outlier Ratio</p>
<span class="text-amber-400 font-bold text-lg">12.1x</span>
</div>
<div class="col-span-3">
<p class="text-[10px] text-zinc-500 mb-1 uppercase tracking-widest">AI Analysis</p>
<div class="flex items-center gap-1">
<span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
<span class="text-[11px] font-medium truncate">Pattern: Cognitive Dissonance</span>
</div>
</div>
<div class="col-span-2 flex justify-end">
<button class="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-800 group-hover:bg-primary-container transition-colors">
<span class="material-symbols-outlined text-sm group-hover:text-on-primary-container">arrow_forward</span>
</button>
</div>
</div>
<!-- Table Row 2 -->
<div class="grid grid-cols-12 items-center p-4 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors group cursor-pointer border border-transparent hover:border-outline-variant/10">
<div class="col-span-5 flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
<img alt="Preview" data-alt="Data visualization dashboard abstract image" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBw8x3J-iyvqxfQDeYgI4HWsv54iA8kmUQGiOV-PF8u1fCKgqLCBLao_vj3DcHOgKdGRXHiiiun4Z4hLTFNxO2-o5PdD8B0Vjg0oxw51oRcrm4h0aTsaJbOVKuea4Eq7ayyrm4hjJ5qpSsQRS1LPUZEcJPAGiYNkpzWUmlh4ryOSTla65kuBFEV9XXzE6C3WbwMamynDEjiMZkHiB6qnYRUayKEURGKYvEOkk5U4uFQXHHXAaM_BOciAZx2NLIlU-gj37uZ5YetyuIH"/>
</div>
<div>
<p class="text-[11px] text-zinc-500 uppercase font-bold tracking-tighter">Hook Beta</p>
<h4 class="text-sm font-semibold text-on-surface">"Most UI designers are making this..."</h4>
</div>
</div>
<div class="col-span-2 text-center">
<p class="text-[10px] text-zinc-500 mb-1">Outlier Ratio</p>
<span class="text-amber-400 font-bold text-lg">7.8x</span>
</div>
<div class="col-span-3">
<p class="text-[10px] text-zinc-500 mb-1 uppercase tracking-widest">AI Analysis</p>
<div class="flex items-center gap-1">
<span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
<span class="text-[11px] font-medium truncate">Pattern: Negative Constraint</span>
</div>
</div>
<div class="col-span-2 flex justify-end">
<button class="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-800 group-hover:bg-primary-container transition-colors">
<span class="material-symbols-outlined text-sm group-hover:text-on-primary-container">arrow_forward</span>
</button>
</div>
</div>
<!-- Table Row 3 -->
<div class="grid grid-cols-12 items-center p-4 rounded-xl bg-surface-container-low hover:bg-surface-container-high transition-colors group cursor-pointer">
<div class="col-span-5 flex items-center gap-4">
<div class="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
<img alt="Preview" data-alt="Meeting room with whiteboard abstract" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA0c5Aef0Tyqm2VkkrcpjEBtdA2y9U3oLI7C5BIx4sS9pCubiBB0roPNlMcNN9zUIy7IF1r18f9MzzQBC6i2rD3tAXp4fWDxzgKBzEtLBRq8kutIvqp0gauFrPsOdzys6X-rLLeVytJyjCbBjupq_HDeGPVepbLjskLw8CZPf5zx5l0ex-Ub1ys8FGr2nycgREU9mAoKFtHHMOTjsAZ-KKOUOkMaxDyZDXpHItsmWuXUoNfsJqaqCmVHK0eLjihLk4TUrHR4Dcq5PMC"/>
</div>
<div>
<p class="text-[11px] text-zinc-500 uppercase font-bold tracking-tighter">Hook Gamma</p>
<h4 class="text-sm font-semibold text-on-surface">"Why 99% of startups fail at launch"</h4>
</div>
</div>
<div class="col-span-2 text-center">
<p class="text-[10px] text-zinc-500 mb-1">Outlier Ratio</p>
<span class="text-amber-400 font-bold text-lg">5.2x</span>
</div>
<div class="col-span-3">
<p class="text-[10px] text-zinc-500 mb-1 uppercase tracking-widest">AI Analysis</p>
<div class="flex items-center gap-1">
<span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
<span class="text-[11px] font-medium truncate">Pattern: Statistics Anchoring</span>
</div>
</div>
<div class="col-span-2 flex justify-end">
<button class="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-800 group-hover:bg-primary-container transition-colors">
<span class="material-symbols-outlined text-sm group-hover:text-on-primary-container">arrow_forward</span>
</button>
</div>
</div>
</div>
</div>
<!-- Expansion Insights Panel -->
<div class="bg-primary-container/5 rounded-xl border border-primary/10 p-8 relative overflow-hidden">
<div class="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[80px] -mr-32 -mt-32"></div>
<div class="relative flex gap-8">
<div class="shrink-0 w-12 h-12 rounded-xl bg-primary-container flex items-center justify-center">
<span class="material-symbols-outlined text-on-primary-container" style="font-variation-settings: 'FILL' 1;">auto_awesome</span>
</div>
<div class="space-y-4">
<h3 class="text-lg font-bold text-on-surface">Intelligence Breakdown</h3>
<p class="text-sm text-zinc-400 leading-relaxed max-w-xl">
                                Content tagged with <span class="text-primary font-semibold">Cognitive Dissonance</span> is currently outperforming the niche average by 412%. High-velocity thumbnails featuring monochrome backgrounds with high-contrast amber text overlays show the strongest retention rates.
                            </p>
<div class="flex gap-6 pt-2">
<div>
<span class="block text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Suggested Hook</span>
<p class="text-xs font-mono bg-surface-container px-3 py-1 rounded">"Everything you know about [X] is wrong."</p>
</div>
<div>
<span class="block text-[10px] text-zinc-500 uppercase font-bold tracking-widest mb-1">Visual Weight</span>
<p class="text-xs font-mono bg-surface-container px-3 py-1 rounded">Heavy Left Alignment</p>
</div>
</div>
</div>
</div>
</div>
</div>
</section>
<!-- Secondary Feed Section (Asymmetric) -->
<section class="mt-20">
<h3 class="text-2xl font-extrabold tracking-tight mb-8">Content Trajectories.</h3>
<div class="grid grid-cols-4 gap-6">
<!-- Data Card 1 -->
<div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/5">
<div class="flex justify-between items-start mb-6">
<span class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Growth Velocity</span>
<span class="text-emerald-400 text-xs font-bold">+24%</span>
</div>
<div class="h-16 w-full flex items-end gap-1 mb-4">
<div class="flex-1 bg-zinc-800 h-[30%] rounded-sm"></div>
<div class="flex-1 bg-zinc-800 h-[45%] rounded-sm"></div>
<div class="flex-1 bg-zinc-800 h-[35%] rounded-sm"></div>
<div class="flex-1 bg-zinc-800 h-[60%] rounded-sm"></div>
<div class="flex-1 bg-zinc-800 h-[50%] rounded-sm"></div>
<div class="flex-1 bg-primary h-[85%] rounded-sm"></div>
<div class="flex-1 bg-primary h-[100%] rounded-sm"></div>
</div>
<p class="text-sm font-semibold mb-1">Direct Response</p>
<p class="text-[11px] text-zinc-500 italic">Trending upward in Tier 1 regions</p>
</div>
<!-- Data Card 2 -->
<div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/5">
<div class="flex justify-between items-start mb-6">
<span class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Retention Arc</span>
<span class="text-primary text-xs font-bold">Stable</span>
</div>
<div class="flex items-center justify-center h-16 mb-4">
<span class="material-symbols-outlined text-4xl text-zinc-700">analytics</span>
</div>
<p class="text-sm font-semibold mb-1">Narrative Bridge</p>
<p class="text-[11px] text-zinc-500 italic">Drop-off occurs at 0:12 mark</p>
</div>
<!-- Data Card 3 -->
<div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/5">
<div class="flex justify-between items-start mb-6">
<span class="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Sentiment</span>
<span class="text-primary text-xs font-bold">92%</span>
</div>
<div class="flex items-center justify-center h-16 mb-4">
<span class="material-symbols-outlined text-4xl text-zinc-700">mood</span>
</div>
<p class="text-sm font-semibold mb-1">Trust Score</p>
<p class="text-[11px] text-zinc-500 italic">Authority-based content peaking</p>
</div>
<!-- Data Card 4 (CTA style) -->
<div class="bg-primary-container p-6 rounded-xl flex flex-col justify-between">
<p class="text-on-primary-container text-xs font-extrabold uppercase tracking-widest">Actionable</p>
<h4 class="text-on-primary-container font-bold leading-tight">Generate script based on this signal?</h4>
<button class="w-full bg-on-primary-container text-primary-container py-2 rounded-lg text-xs font-bold mt-4 uppercase">
                        Initialize Factory
                    </button>
</div>
</div>
</section>
</main>
<!-- TopNavBar (Fixed Header Shell) -->
<div class="fixed top-0 left-[220px] right-0 h-14 z-50 bg-zinc-50/80 dark:bg-zinc-950/80 backdrop-blur-xl flex justify-between items-center px-8 border-b border-zinc-200/20 dark:border-zinc-800/20">
<div class="flex items-center gap-6">
<div class="flex items-center gap-2 bg-zinc-900/5 dark:bg-zinc-100/5 px-3 py-1.5 rounded-full border border-zinc-200/10 dark:border-zinc-800/10">
<span class="material-symbols-outlined text-sm text-zinc-400">search</span>
<input class="bg-transparent border-none text-xs focus:ring-0 text-on-surface w-48 placeholder:text-zinc-600" placeholder="Search Intelligence..." type="text"/>
</div>
</div>
<div class="flex items-center gap-4">
<button class="p-2 text-zinc-500 hover:text-primary transition-colors">
<span class="material-symbols-outlined">notifications</span>
</button>
<div class="w-[1px] h-4 bg-zinc-800"></div>
<div class="flex items-center gap-3">
<div class="text-right">
<p class="text-[10px] font-bold text-on-surface leading-none">Alex Rivers</p>
<p class="text-[9px] text-zinc-500 uppercase tracking-tighter">Strategist</p>
</div>
<div class="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 overflow-hidden">
<img alt="User Profile" data-alt="User profile picture of a young professional" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD_3djZSPdNzp8-5EU9OGgkIYsqluTZSeynPXagRf7cTY8O_ativLX6-fUlx2X8tvIQ4AkjBVovDgjp_s0bH8360Z8DjAd6La_hF4mIoSSGBby5Gb1P_mHTCuo0_h7Wcf8PsssoeuwbYd-vb70gA-ojYYaLV218AsR7Oqg68MMVR5SUkmhDlRVE2jz3oJnCkSaxN0JyfLjZF6N4L93KxN_D282Bo05ti8DDeaOi_uqm5u_-NhUWCcCFYmuJ98l8bVDVHksgJsczH8Np"/>
</div>
</div>
</div>
</div>
</body></html>