/**
 * 性能分析工具
 * 用于精确测量模拟引擎各个阶段的耗时
 */

export interface ProfileResult {
  name: string;
  duration: number;
  count: number;
  avgDuration: number;
  percentage: number;
}

export class Profiler {
  private timings = new Map<string, { total: number; count: number }>();
  private stack: Array<{ name: string; start: number }> = [];
  private enabled = false;

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  reset(): void {
    this.timings.clear();
    this.stack = [];
  }

  start(name: string): void {
    if (!this.enabled) return;
    this.stack.push({ name, start: performance.now() });
  }

  end(name: string): void {
    if (!this.enabled) return;
    const entry = this.stack.pop();
    if (!entry || entry.name !== name) {
      console.warn(`Profiler: mismatched end() for "${name}"`);
      return;
    }

    const duration = performance.now() - entry.start;
    const existing = this.timings.get(name);
    if (existing) {
      existing.total += duration;
      existing.count++;
    } else {
      this.timings.set(name, { total: duration, count: 1 });
    }
  }

  getResults(): ProfileResult[] {
    const results: ProfileResult[] = [];
    let totalTime = 0;

    for (const [, data] of this.timings) {
      totalTime += data.total;
    }

    for (const [name, data] of this.timings) {
      results.push({
        name,
        duration: data.total,
        count: data.count,
        avgDuration: data.total / data.count,
        percentage: totalTime > 0 ? (data.total / totalTime) * 100 : 0,
      });
    }

    return results.sort((a, b) => b.duration - a.duration);
  }

  printResults(): void {
    const results = this.getResults();
    console.log('\n=== Performance Profile ===');
    console.log('Name'.padEnd(30), 'Total(ms)'.padStart(12), 'Count'.padStart(8), 'Avg(ms)'.padStart(10), '%'.padStart(8));
    console.log('-'.repeat(80));

    for (const r of results) {
      console.log(
        r.name.padEnd(30),
        r.duration.toFixed(2).padStart(12),
        r.count.toString().padStart(8),
        r.avgDuration.toFixed(3).padStart(10),
        r.percentage.toFixed(1).padStart(7) + '%'
      );
    }
    console.log('='.repeat(80));
  }
}

export const profiler = new Profiler();
