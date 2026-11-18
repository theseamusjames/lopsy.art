/** The sidebar's Dates section (spec 5.2): year, then month, then day, newest first. */

import type { Asset } from '../library/types';
import { assetDay } from './asset-fields';

export interface DateDay {
  /** 'YYYY-MM-DD' */
  readonly day: string;
  readonly count: number;
}

export interface DateMonth {
  /** 'YYYY-MM' */
  readonly month: string;
  readonly count: number;
  readonly days: readonly DateDay[];
}

export interface DateYear {
  /** 'YYYY' */
  readonly year: string;
  readonly count: number;
  readonly months: readonly DateMonth[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Counts by capture day (else import day). Assets with no usable date are left out. */
export function buildDateTree(assets: Iterable<Asset>): DateYear[] {
  const byDay = new Map<string, number>();
  for (const asset of assets) {
    const day = assetDay(asset);
    if (DAY.test(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const years: { year: string; count: number; months: { month: string; count: number; days: DateDay[] }[] }[] = [];
  for (const day of [...byDay.keys()].sort().reverse()) {
    const count = byDay.get(day) ?? 0;
    let year = years[years.length - 1];
    if (!year || year.year !== day.slice(0, 4)) {
      year = { year: day.slice(0, 4), count: 0, months: [] };
      years.push(year);
    }
    let month = year.months[year.months.length - 1];
    if (!month || month.month !== day.slice(0, 7)) {
      month = { month: day.slice(0, 7), count: 0, days: [] };
      year.months.push(month);
    }
    month.days.push({ day, count });
    month.count += count;
    year.count += count;
  }
  return years;
}
