'use client';

import { useState } from 'react';
import { GOVERNORATES } from '@hf/shared';
import { citiesOf } from '@/lib/format';
import { t, type Locale } from '@/lib/i18n';

/**
 * Governorate + city selects for the GET filter form. Server-rendered with the current values so it works without
 * JavaScript; once hydrated, the city list follows the chosen governorate (LOC-7 cities).
 */
export function LocationFilter({ locale, governorate, city, className }: { locale: Locale; governorate?: string; city?: string; className: string }) {
  const [gov, setGov] = useState(governorate ?? '');
  const [c, setC] = useState(city ?? '');
  const cities = citiesOf(gov);
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-gov" className="text-sm font-medium">
          {t(locale, 'filter.governorate')}
        </label>
        <select
          id="f-gov"
          name="governorate"
          value={gov}
          onChange={(e) => {
            setGov(e.target.value);
            setC('');
          }}
          className={className}
        >
          <option value="">{t(locale, 'site.all')}</option>
          {GOVERNORATES.map((g) => (
            <option key={g.slug} value={g.slug}>
              {g[locale]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="f-city" className="text-sm font-medium">
          {t(locale, 'filter.city')}
        </label>
        <select id="f-city" name="city" value={c} onChange={(e) => setC(e.target.value)} disabled={!cities.length} aria-describedby={cities.length ? undefined : 'f-city-hint'} className={className}>
          <option value="">{t(locale, 'site.all')}</option>
          {cities.map((x) => (
            <option key={x.ar} value={x.ar}>
              {x[locale]}
            </option>
          ))}
        </select>
        {!cities.length && (
          <span id="f-city-hint" className="text-xs text-muted">
            {t(locale, 'filter.cityHint')}
          </span>
        )}
      </div>
    </>
  );
}
