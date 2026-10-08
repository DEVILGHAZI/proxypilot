import { execFile } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright-core";

export type VisitRequest = {
  url: string;
  proxyServer: string;
  username?: string;
  password?: string;
  layout: "chrome" | "phone";
};

export type VisitOutcome = {
  ok: boolean;
  title: string | null;
  scrolled: boolean;
  latencyMs: number;
  errorCode: string | null;
};

const VIEWPORTS = {
  chrome: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

export function pageLoaded(status: number | null, title: string, bodyLength: number): boolean {
  return status !== null && status >= 200 && status < 400 && (title.trim().length > 0 || bodyLength > 0);
}

export function visitErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/channel|executable doesn't exist|browserType|not found/i.test(message)) {
    return "CHROME_UNAVAILABLE";
  }
  if (/timeout/i.test(message)) {
    return "TIMEOUT";
  }
  return "VISIT_FAILED";
}

function showChromeWindow(): Promise<void> {
  if (process.platform !== "darwin") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile("ps", ["-ax", "-o", "pid=,ppid=,command="], (error, stdout) => {
      if (error) {
        resolve();
        return;
      }
      const rows = new Map<number, { parent: number; command: string }>();
      for (const line of stdout.split("\n")) {
        const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
        if (!match?.[1] || !match[2] || !match[3]) {
          continue;
        }
        rows.set(Number(match[1]), { parent: Number(match[2]), command: match[3] });
      }
      const chromePid = [...rows.entries()].find(([, row]) => {
        if (!row.command.includes("Google Chrome.app/Contents/MacOS/Google Chrome")) {
          return false;
        }
        let parent = row.parent;
        for (let depth = 0; depth < 6 && parent > 0; depth += 1) {
          if (parent === process.pid) {
            return true;
          }
          parent = rows.get(parent)?.parent ?? 0;
        }
        return false;
      })?.[0];
      if (chromePid === undefined) {
        resolve();
        return;
      }
      const script = `tell application "System Events" to set frontmost of the first process whose unix id is ${chromePid} to true`;
      execFile("osascript", ["-e", script], () => resolve());
    });
  });
}

async function scrollPage(page: Pick<Page, "evaluate">): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let traveled = 0;
      const step = () => {
        const height = document.body?.scrollHeight ?? 0;
        window.scrollBy(0, 500);
        traveled += 500;
        if (traveled >= height || traveled >= 4000) {
          resolve();
          return;
        }
        window.setTimeout(step, 400);
      };
      step();
    });
  });
}

export async function visitThroughProxy(input: VisitRequest): Promise<VisitOutcome> {
  const started = Date.now();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: false,
      ignoreDefaultArgs: ["--no-startup-window"],
      args: ["--window-position=40,40", "--window-size=1280,860"],
      proxy: {
        server: input.proxyServer,
        username: input.username,
        password: input.password,
      },
    });
    const page = await browser.newPage({
      viewport: VIEWPORTS[input.layout],
      isMobile: input.layout === "phone",
      hasTouch: input.layout === "phone",
    });
    await page.bringToFront();
    await showChromeWindow();
    const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();
    await showChromeWindow();
    await scrollPage(page);
    await page.bringToFront();
    await showChromeWindow();
    await page.waitForTimeout(8_000);
    const title = (await page.title()).slice(0, 120);
    const bodyLength = await page.evaluate(() => document.body?.innerText?.trim().length ?? 0);
    const status = response?.status() ?? null;
    const ok = pageLoaded(status, title, bodyLength);
    return {
      ok,
      title: title || null,
      scrolled: true,
      latencyMs: Date.now() - started,
      errorCode: ok ? null : "PAGE_UNUSABLE",
    };
  } catch (error) {
    return {
      ok: false,
      title: null,
      scrolled: false,
      latencyMs: Date.now() - started,
      errorCode: visitErrorCode(error),
    };
  } finally {
    await browser?.close();
  }
}
