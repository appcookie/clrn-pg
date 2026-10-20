import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { packagedAnimations } from '../animation-assets';
import { simulatorAppPath } from '../device';

if (['all', 'guest'].includes(process.env.IOS_GROUP || 'all') && (process.env.IOS_LOCALE || 'en') === 'en') {
  test('published iOS simulator app contains every reviewed animation asset', async ({}, info) => {
    const observed = packagedAnimations(await simulatorAppPath());
    await info.attach('packaged-animation-assets', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
    const baseline = path.resolve('ios/snapshots/full/iphone16-ios18.5-en/animation-assets.json');
    if (process.env.IOS_VISUAL_MODE === 'reference') {
      mkdirSync(path.dirname(baseline), { recursive: true });
      writeFileSync(baseline, JSON.stringify(observed, null, 2) + '\n');
    }
    else if (process.env.IOS_VISUAL_MODE === 'compare') expect(observed).toEqual(JSON.parse(readFileSync(baseline, 'utf8')));
  });
}
