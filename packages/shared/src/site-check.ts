export const SITE_CHECK_JOB = "visit";
export const SITE_CHECK_MAX_PROXIES = 100;

export const SITE_CHECK_BROWSERS = ["CHROME", "PHONE", "MIXED"] as const;

export type SiteCheckBrowserName = (typeof SITE_CHECK_BROWSERS)[number];
export type SiteCheckLayout = "chrome" | "phone";

export function siteCheckLayout(browser: SiteCheckBrowserName, index: number): SiteCheckLayout {
  if (browser === "PHONE") {
    return "phone";
  }
  if (browser === "MIXED") {
    return index % 2 === 0 ? "chrome" : "phone";
  }
  return "chrome";
}

export function siteCheckSummary(passed: number, total: number): string {
  if (total === 0) {
    return "No proxies were checked.";
  }
  if (passed === total) {
    return `Your site loaded on all ${total} ${total === 1 ? "proxy" : "proxies"}.`;
  }
  return `Your site loaded on ${passed} of ${total} proxies.`;
}
