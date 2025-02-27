const puppeteer = require('puppeteer');

async function scrapeMultipleUrls(urls, config) {
  const browser = await puppeteer.launch({
    headless: "new",
    defaultViewport: { width: 1920, height: 1080 }
  });

  const results = [];

  try {
    for (const url of urls) {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

      const result = {
        url,
        timestamp: new Date().toISOString(),
        data: {},
        error: null
      };

      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for the specified element if provided
        if (config.waitForElement) {
          await page.waitForSelector(config.waitForElement, { timeout: 10000 })
            .catch(() => console.log(`Warning: Wait element not found on ${url}`));
        }

        // Scrape each specified selector
        for (const [key, selector] of Object.entries(config.selectors)) {
          result.data[key] = await page.evaluate((sel) => {
            const elements = document.querySelectorAll(sel);
            if (elements.length === 0) return null;
            if (elements.length === 1) return elements[0].textContent.trim();
            return Array.from(elements).map(el => el.textContent.trim());
          }, selector);
        }

      } catch (error) {
        result.error = error.message;
      }

      results.push(result);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

// Example usage:
const urlsToScrape = [
  'https://example.com/page1',
  'https://example.com/page2'
];

const scrapingConfig = {
  waitForElement: '.main-content',
  selectors: {
    title: 'h1',
    description: '.description',
    prices: '.price',
    metadata: '.meta-info'
  }
};

async function runScraper() {
  try {
    const data = await scrapeMultipleUrls(urlsToScrape, scrapingConfig);
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Scraping failed:', error);
  }
}

runScraper();