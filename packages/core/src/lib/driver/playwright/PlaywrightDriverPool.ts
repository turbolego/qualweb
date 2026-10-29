import type { Browser, Page } from 'playwright';
import type { ClusterOptions } from '../../ClusterOptions';
import type { DriverPage, DriverPool, EvaluationJobData } from '../types';
import { PlaywrightDriverPage } from './PlaywrightDriverPage';

/**
 * {@link DriverPool} implementation for Playwright. Mirrors the semantics
 * QualWeb consumed from puppeteer-cluster's CONCURRENCY_CONTEXT mode: one
 * shared browser, one isolated incognito context per job, at most
 * `maxConcurrency` jobs in flight, and a per-job timeout that reports
 * through the task error handler instead of rejecting.
 */
export class PlaywrightDriverPool implements DriverPool {
  private handler?: (page: DriverPage, data: EvaluationJobData) => Promise<void>;
  private readonly errorHandlers: Array<(error: Error, data: EvaluationJobData) => void> = [];
  private readonly pending: EvaluationJobData[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private active = 0;
  private closed = false;

  private readonly maxConcurrency: number;
  private readonly timeout: number;

  private browserUserAgentPromise?: Promise<string>;

  constructor(
    private readonly browser: Browser,
    clusterOptions?: ClusterOptions,
    private readonly setupPage?: (page: Page) => Promise<void>
  ) {
    this.maxConcurrency = clusterOptions?.maxConcurrency ?? 1;
    // Same default as puppeteer-cluster's job timeout in the Puppeteer driver.
    this.timeout = clusterOptions?.timeout ?? 60 * 1000;
    if (!Number.isInteger(this.maxConcurrency) || this.maxConcurrency < 1 ||
        !Number.isFinite(this.timeout) || this.timeout <= 0) {
      throw new RangeError('Concurrency must be a positive integer and timeout must be positive.');
    }
  }

  public async task(handler: (page: DriverPage, data: EvaluationJobData) => Promise<void>): Promise<void> {
    this.handler = handler;
  }

  public queue(data: EvaluationJobData): void {
    if (this.closed) {
      throw new Error('Cannot queue evaluations on a closed browser pool.');
    }
    this.pending.push(data);
    this.pump();
  }

  public idle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  public async close(): Promise<void> {
    this.closed = true;
    this.pending.length = 0;
    await this.browser.close();
  }

  public onTaskError(handler: (error: Error, data: EvaluationJobData) => void): void {
    this.errorHandlers.push(handler);
  }

  private pump(): void {
    while (!this.closed && this.active < this.maxConcurrency && this.pending.length > 0) {
      const data = this.pending.shift() as EvaluationJobData;
      this.active++;
      void this.runJob(data).finally(() => {
        this.active--;
        this.pump();
      });
    }
    this.checkIdle();
  }

  private async runJob(data: EvaluationJobData): Promise<void> {
    let page: PlaywrightDriverPage | undefined;
    try {
      if (!this.handler) {
        throw new Error('No task handler was registered on the pool.');
      }
      page = await PlaywrightDriverPage.create(this.browser, await this.getBrowserUserAgent(), this.setupPage);
      await this.withTimeout(this.handler(page, data));
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      for (const handler of this.errorHandlers) {
        handler(wrapped, data);
      }
    } finally {
      try {
        await page?.dispose();
      } catch (error) {
        if (!this.closed) {
          const wrapped = error instanceof Error ? error : new Error(String(error));
          for (const handler of this.errorHandlers) {
            handler(wrapped, data);
          }
        }
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout hit: ${this.timeout}`)),
        this.timeout
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private checkIdle(): void {
    if (this.active === 0 && this.pending.length === 0) {
      const resolvers = this.idleResolvers.splice(0);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  /**
   * The browser's default user agent (with no context override). Playwright
   * has no direct equivalent of Puppeteer's Browser.userAgent(), so it is
   * read once from a throwaway context and cached.
   */
  private getBrowserUserAgent(): Promise<string> {
    if (!this.browserUserAgentPromise) {
      this.browserUserAgentPromise = (async (): Promise<string> => {
        const context = await this.browser.newContext();
        try {
          const page = await context.newPage();
          return await page.evaluate(() => navigator.userAgent);
        } finally {
          await context.close();
        }
      })();
    }
    return this.browserUserAgentPromise;
  }
}
