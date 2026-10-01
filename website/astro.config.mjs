import { defineConfig } from 'astro/config';

export default defineConfig({
  // Project Pages URL: https://mihailm17.github.io/slate-log/
  // Same repo, no second repo needed. The workflow in
  // .github/workflows/website.yml builds website/ and deploys dist/.
  // If you switch to a custom domain, remove `base` and set `site` to it.
  site: 'https://mihailm17.github.io/slate-log',
  base: '/slate-log',
  output: 'static',
});
