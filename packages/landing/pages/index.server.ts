import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Spool — Your AI session library";
const DESC =
  "Every Claude, Codex, Gemini, and OpenCode session you've ever had, in one local library. Browse by project, pin what matters, and search across everything with ⌘K. Local-first; nothing leaves your machine.";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [
    { name: "description", content: DESC },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://spool.pro/" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESC },
    { property: "og:image", content: "https://spool.pro/og-image.png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:site_name", content: "Spool" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESC },
    { name: "twitter:image", content: "https://spool.pro/og-image.png" },
  ],
  link: [
    { rel: "canonical", href: "https://spool.pro/" },
    { rel: "alternate", type: "application/rss+xml", title: "Spool Blog", href: "/blog/rss.xml" },
  ],
  script: [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Spool",
        description:
          "Your local AI session library. Browse, pin, and search every Claude Code, Codex, Gemini, Antigravity, and OpenCode session you've ever had — entirely on your machine. Your AI agents can query it too via the /spool skill.",
        url: "https://spool.pro",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: { "@type": "Person", name: "Yifeng", url: "https://github.com/doodlewind" },
      }),
    },
  ],
}));
