// Builds StreamWing Research from the registry in tools/research/publications.mjs:
//   site/research/index.html                 the research index
//   site/research/<slug>/index.html          one page per published article
//   site/sitemap.xml and site/robots.txt
// Run: node tools/build-research.mjs && node tools/build.mjs
// The shared header and footer are stamped by tools/build.mjs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { publications, siteName } from './research/publications.mjs';

const SITE = 'https://streamwing.studio';
const site = new URL('../site/', import.meta.url).pathname;
const contentDir = new URL('./research/content/', import.meta.url).pathname;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const words = (html) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

// Only published articles reach the public site. Drafts stay in the registry and out of every page.
const published = publications
  .filter((p) => p.status === 'published')
  .sort((a, b) => a.number.localeCompare(b.number))
  .map((p) => {
    const body = readFileSync(contentDir + p.slug + '.html', 'utf8');
    return { ...p, body, readingMinutes: Math.max(1, Math.ceil(words(body) / 220)) };
  });

const headBits = ({ seoTitle, description, canonical, ogType, image, imageAlt, jsonld }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(seoTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${siteName}">
<meta property="og:title" content="${esc(seoTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}${image}">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(seoTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}${image}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/theme-night-plum.css">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/base.css">
<link rel="stylesheet" href="/assets/css/components.css">
<link rel="stylesheet" href="/assets/css/research.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>document.documentElement.classList.add('js')</script>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body><a class="skip" href="#main">Skip to content</a>
<!-- chrome:header --><!-- /chrome:header -->
`;

const tailBits = (extraScript = '') => `
<!-- chrome:footer --><!-- /chrome:footer -->
${extraScript}</body>
</html>
`;

// Mobile: the list collapses behind a button. Desktop: always shown. Without JavaScript the list stays visible.
const sidebarScript = `<script>(function(){var a=document.getElementById('rs');if(!a)return;var b=a.querySelector('.rs-toggle'),l=document.getElementById('rsList'),mq=matchMedia('(max-width:820px)');function sync(){l.hidden=mq.matches&&b.getAttribute('aria-expanded')!=='true';}b.addEventListener('click',function(){b.setAttribute('aria-expanded',b.getAttribute('aria-expanded')==='true'?'false':'true');sync();});mq.addEventListener('change',function(){b.setAttribute('aria-expanded','false');sync();});sync();})();</script>
`;

const breadcrumb = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});

const publisher = { '@type': 'Organization', name: siteName, url: SITE + '/' };

function sidebar(current) {
  const items = published.map((p) => `<li><a class="rs-item" href="/research/${p.slug}/"${current && current.slug === p.slug ? ' aria-current="page"' : ''}><span class="rs-num" aria-hidden="true">${p.number}</span><span><span class="rs-name">${esc(p.title)}</span><span class="rs-desc">${esc(p.navDescription)}</span></span></a></li>`).join('');
  return `<aside class="side rs" id="rs" aria-labelledby="rsTitle"><div class="rs-head"><h2 id="rsTitle">StreamWing Research</h2><button type="button" class="rs-toggle" aria-expanded="false" aria-controls="rsList">Browse articles</button></div><nav aria-label="Research articles"><ul class="rs-list" id="rsList">${items}</ul></nav><a class="rs-back" href="/research/">All research</a></aside>`;
}

function articlePage(p, index) {
  const canonical = `${SITE}/research/${p.slug}/`;
  const prev = published[index - 1];
  const next = published[index + 1];
  const pn = [
    prev ? `<a class="pn-link pn-prev" href="/research/${prev.slug}/"><span class="pn-label">Previous</span>${esc(prev.title)}</a>` : '',
    next ? `<a class="pn-link pn-next" href="/research/${next.slug}/"><span class="pn-label">Next</span>${esc(next.title)}</a>` : '',
  ].join('');
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: p.fullTitle, description: p.metaDescription, image: [SITE + p.image], datePublished: p.publishedDate, dateModified: p.updatedDate, author: { '@type': 'Organization', name: p.author, url: SITE + '/' }, publisher, mainEntityOfPage: canonical, articleSection: p.category, keywords: p.tags.join(', '), inLanguage: 'en-US', isAccessibleForFree: true },
    breadcrumb([{ name: 'Home', url: SITE + '/' }, { name: 'Research', url: SITE + '/research/' }, { name: p.title, url: canonical }]),
  ];
  const head = headBits({ seoTitle: p.seoTitle, description: p.metaDescription, canonical, ogType: 'article', image: p.image, imageAlt: p.imageAlt, jsonld });
  const body = `<main id="main" class="rx-main"><div class="wrap two">
<article class="doc" aria-labelledby="articleTitle">
<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/research/">Research</a></li><li aria-current="page">${esc(p.title)}</li></ol></nav>
<header class="ah">
<p class="kicker">${p.number} · ${esc(p.category)}</p>
<h1 id="articleTitle">${esc(p.fullTitle)}</h1>
<p class="sub">${esc(p.subtitle)}</p>
<p class="meta">By ${esc(p.author)} · Published <time datetime="${p.publishedDate}">${fmtDate(p.publishedDate)}</time> · Last updated <time datetime="${p.updatedDate}">${fmtDate(p.updatedDate)}</time> · ${p.readingMinutes} min read</p>
</header>
${p.body}
<nav class="pn" aria-label="More research">${pn}</nav>
<p class="note"><a href="/research/">Back to all StreamWing Research</a></p>
</article>
${sidebar(p)}
</div></main>
`;
  return head + body + tailBits(sidebarScript);
}

function indexPage() {
  const canonical = `${SITE}/research/`;
  const title = 'StreamWing Research | Webcam Industry & Performer Business Insights';
  const description = 'Explore evidence-based research on webcam performer economics, independent business operations, professional workflows, software adoption, and technology.';
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'StreamWing Research', headline: 'Understanding the business behind the broadcast.', description, url: canonical, publisher, inLanguage: 'en-US', hasPart: published.map((p) => ({ '@type': 'Article', headline: p.fullTitle, url: `${SITE}/research/${p.slug}/`, datePublished: p.publishedDate })) },
    breadcrumb([{ name: 'Home', url: SITE + '/' }, { name: 'Research', url: canonical }]),
  ];
  const cards = published.map((p) => `<li class="rx-card">
<p class="rx-meta">${p.number} · ${esc(p.category)} · <time datetime="${p.publishedDate}">${fmtDate(p.publishedDate)}</time> · ${p.readingMinutes} min read</p>
<h2><a href="/research/${p.slug}/">${esc(p.fullTitle)}</a></h2>
<p>${esc(p.summary)}</p>
</li>`).join('');
  const head = headBits({ seoTitle: title, description, canonical, ogType: 'website', image: '/promo-poster.jpg', imageAlt: 'StreamWing promotional poster', jsonld });
  const body = `<main id="main" class="rx-main"><div class="wrap rx-index">
<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Research</li></ol></nav>
<header class="rx-head">
<p class="kicker">StreamWing Research</p>
<h1>Understanding the business behind the broadcast.</h1>
<p class="rx-lede">Evidence-based research into the working lives, business practices, and technology choices of independent webcam performers.</p>
<p class="note">StreamWing Research publishes secondary research and evidence synthesis compiled by StreamWing. The original studies, surveys, and interviews belong to the researchers named in each article. StreamWing did not conduct them.</p>
</header>
<h2 class="rx-h">Publications</h2>
<ol class="rx-list">${cards}</ol>
</div></main>
`;
  return head + body + tailBits();
}

// Write pages
const researchDir = site + 'research/';
mkdirSync(researchDir, { recursive: true });
writeFileSync(researchDir + 'index.html', indexPage());
published.forEach((p, i) => {
  mkdirSync(researchDir + p.slug, { recursive: true });
  writeFileSync(researchDir + p.slug + '/index.html', articlePage(p, i));
});

// Sitemap: public pages and published research only. Survey, admin and utility pages are excluded.
const staticUrls = ['/', '/how-it-works/', '/pricing/', '/connect-to-chaturbate/', '/privacy/', '/terms/'];
const entries = [
  ...staticUrls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`),
  `  <url><loc>${SITE}/research/</loc></url>`,
  ...published.map((p) => `  <url><loc>${SITE}/research/${p.slug}/</loc><lastmod>${p.updatedDate}</lastmod></url>`),
];
writeFileSync(site + 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`);
writeFileSync(site + 'robots.txt', `User-agent: *\nAllow: /\nDisallow: /research/admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`research: index + ${published.length} article(s); sitemap and robots.txt written`);
