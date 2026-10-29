# QualWeb Playwright driver

Playwright is now the default browser backend in `@qualweb/core`. This package
is a compatibility re-export, so existing imports of `PlaywrightDriver`,
`PlaywrightDriverPage`, `PlaywrightDriverPool`, and `mapLoadEvent` still work.
New applications can import these directly from `@qualweb/core`.

Requires Node.js 20 or newer.

```sh
npm install @qualweb/core @qualweb/playwright-driver playwright
npx playwright install chromium
```

```typescript
import { QualWeb, PlaywrightDriver } from '@qualweb/core';

const driver = new PlaywrightDriver({
  browser: 'chromium', // 'firefox' and 'webkit' are also available
  launchOptions: { headless: true },
  adBlock: true,
});
const qualweb = new QualWeb(undefined, driver);
await qualweb.start({ maxConcurrency: 4 });
try {
  const reports = await qualweb.evaluate({ url, modules });
} finally {
  await qualweb.stop();
}
```

Install the corresponding Playwright browser before choosing Firefox or WebKit.
Options passed as the second argument of `start()` override the driver's
constructor launch options. The default pool does not support Puppeteer's
cluster monitor; `monitor: true` throws.

Ad blocking uses Ghostery's full ads, tracking, and annoyances lists. For offline
or custom lists, pass a `PlaywrightBlocker` from `@ghostery/adblocker-playwright`
as `blocker`. Blocking is applied to evaluation and crawler pages, including
replacement contexts for user-agent/mobile settings. Filter setup errors are
propagated; failed evaluation jobs use QualWeb's existing error manager.

The abandoned stealth and Puppeteer-extra integrations are not used. Passing
`stealth: true` to QualWeb throws a migration error.

## Browser compatibility

- `networkidle0` and `networkidle2` map to Playwright `networkidle`; arrays
  collapse to the strongest event.
- Context-only user-agent, CSP, device scale, mobile, and touch settings recreate
  the context before navigation. Set these before loading the document.
  Mid-evaluation dimension changes preserve the loaded document and injected
  scripts.
- Plugins receive a neutral driver page. `nativePage` is a Playwright `Page`.
- `QualWeb.createPage()` accepts the neutral adapter, not a raw automation page.

See the [migration guide](../../README.md) and
[optional Puppeteer backend](../puppeteer-driver/README.md).

## License

ISC
