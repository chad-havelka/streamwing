// StreamWing Research: the publication registry.
//
// Every research article is listed here once. The index, the article sidebar, previous and
// next links, the sitemap and the structured data are all built from this list.
//
// status: "published" shows the article everywhere. "draft" keeps it out of every public page.
// Article body: tools/research/content/<slug>.html (read only when the status is "published").
//
// Dates are YYYY-MM-DD. Update updatedDate whenever the article text changes.

export const publications = [
  {
    number: '01',
    slug: 'the-business-of-camming',
    status: 'published',
    title: 'The Business of Camming',
    fullTitle: 'The Business of Camming: Understanding the Working Lives of Webcam Performers',
    subtitle: 'Professional independence, economics, and working conditions in webcam performance.',
    navDescription: 'Professional independence, economics, and working conditions.',
    summary: 'How webcam performers work, earn, and set boundaries, drawn from a 2022 observation of Chaturbate tipping and recent research on other platforms.',
    category: 'Business and economics',
    tags: ['webcam performer business', 'webcam performer income', 'Chaturbate performer research', 'independent webcam performers', 'webcam industry statistics'],
    publishedDate: '2026-11-26',
    updatedDate: '2026-11-26',
    seoTitle: 'The Business of Camming: Webcam Performer Research | StreamWing',
    metaDescription: 'Explore research into webcam performer income, professional independence, working conditions, privacy, and the realities of operating a camming business.',
    image: '/promo-poster.jpg',
    imageAlt: 'StreamWing promotional poster',
    author: 'StreamWing',
  },
  {
    number: '02',
    slug: 'webcam-performer-technology-adoption',
    status: 'draft',
    title: 'Technology Behind the Broadcast',
    fullTitle: 'Technology Behind the Broadcast: How Webcam Performers Choose Professional Software',
    subtitle: 'Software adoption, purchasing decisions, and professional tools.',
    navDescription: 'Software adoption, purchasing decisions, and professional tools.',
    summary: 'How webcam performers evaluate broadcasting software, analytics, free and paid tools, and the open questions around AI.',
    category: 'Technology and software',
    tags: ['webcam performer software', 'camming software', 'Chaturbate analytics', 'webcam performer tools', 'webcam software adoption'],
    publishedDate: '2026-11-26',
    updatedDate: '2026-11-26',
    seoTitle: 'Webcam Performer Software & Technology Adoption | StreamWing',
    metaDescription: 'Discover how webcam performers evaluate professional software, analytics, free tools, subscriptions, privacy, and emerging AI technologies.',
    image: '/promo-poster.jpg',
    imageAlt: 'StreamWing promotional poster',
    author: 'StreamWing',
  },
];

export const siteName = 'StreamWing';
