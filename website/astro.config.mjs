import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc from 'starlight-typedoc';

export default defineConfig({
  site: 'https://no-witness-labs.github.io',
  base: '/midday-sdk',
  integrations: [
    starlight({
      title: 'Midday SDK',
      description: 'Developer-friendly SDK for building dapps on Midnight Network',
      social: {
        github: 'https://github.com/no-witness-labs/midday-sdk',
      },
      editLink: {
        baseUrl: 'https://github.com/no-witness-labs/midday-sdk/edit/main/website/',
      },
      plugins: [
        starlightTypeDoc({
          entryPoints: ['../src/index.ts'],
          tsconfig: '../tsconfig.json',
          output: 'api',
          sidebar: {
            label: 'API Reference',
            collapsed: true,
          },
          typeDoc: {
            excludePrivate: true,
            excludeInternal: true,
            readme: 'none',
          },
        }),
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Contract Operations', slug: 'guides/contract-operations' },
            { label: 'Effect API', slug: 'guides/effect-api' },
            { label: 'Browser Usage', slug: 'guides/browser-usage' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Decision Records', slug: 'architecture' },
            { label: 'ADR-001: Dual API Pattern', slug: 'architecture/adr-001-dual-api-pattern' },
            { label: 'ADR-002: Module-Function Design', slug: 'architecture/adr-002-module-function-design' },
            { label: 'ADR-003: Effect Framework', slug: 'architecture/adr-003-effect-framework' },
            { label: 'ADR-004: Tagged Errors', slug: 'architecture/adr-004-tagged-errors' },
          ],
        },
        {
          label: 'API Reference',
          autogenerate: { directory: 'api' },
        },
      ],
      customCss: ['./src/styles/custom.css'],
    }),
  ],
});
