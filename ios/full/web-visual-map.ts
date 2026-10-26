import { buildScenarios } from '../../visual/scenarios';
import { iosScenarios } from './scenarios';
export function webVisualMapping(locale = 'en') {
  const cases = buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: 'all' })
    .filter(row => row.viewport.label === 'mobile');
  const applications = new Set(iosScenarios(locale, 'all').map(row => row.pageLabel));
  const rows = cases.flatMap(row => (row.snapshotStates || ['default']).map(state => {
    const kind = applications.has(row.pageLabel) ? 'application' : row.group === 'game-record' ? 'records'
      : row.group === 'texas-holdem' ? 'texas' : row.group === 'zhajinhua' ? 'zhajinhua' : undefined;
    if (!kind) throw new Error(`没有原生执行器：${row.pageLabel}`);
    const part = locale !== 'en' || !['texas','zhajinhua'].includes(kind) ? ''
      : row.pageLabel.endsWith('_pre_game') && !row.pageLabel.includes('optional')
        ? row.snapshotStates!.indexOf(state) < (kind === 'texas' ? 3 : 7) ? '_first'
          : kind === 'texas' && row.snapshotStates!.indexOf(state) < 7 ? '_middle' : '_second'
        : row.pageLabel === 'signed_in_texas_game' ? row.snapshotStates!.indexOf(state) < 10 ? '_table' : '_effects'
          : row.pageLabel === 'signed_in_zhajinhua_game' ? '_table' : '';
    return { pageLabel: row.pageLabel, state,
      file: `ios/full/tests/${row.pageLabel === 'signed_in_club_rooms_populated' ? 'club-rooms-populated'
        : kind === 'application' ? 'parity' : kind === 'records' ? 'records' : 'games'}.spec.ts`,
      title: `${locale} / ${kind === 'application' || kind === 'records' ? row.group : kind} / ${row.pageLabel}${part}`,
      capture: locale === 'en' && row.pageLabel === 'signed_in_texas_hall' && state === 'level_up' ? 'animated-level-up' : 'static',
    };
  }));
  rows.push(...(['launch_staging_notice','launch_branding'] as const).map(pageLabel => ({ pageLabel, state: 'default',
    file: `ios/full/tests/${pageLabel === 'launch_branding' ? 'launch-branding' : 'launch-pages'}.spec.ts`,
    title: `${locale} ${pageLabel} full screen${pageLabel === 'launch_branding' ? ' while initialization waits' : ''}`, capture: 'static' })));
  return rows;
}
