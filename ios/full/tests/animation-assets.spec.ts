import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { packagedAnimations } from '../animation-assets';
import { simulatorAppPath } from '../device';

const baseline = JSON.parse(readFileSync(new URL('../animation-assets.json', import.meta.url), 'utf8'));

if (['all', 'guest'].includes(process.env.IOS_GROUP || 'all') && (process.env.IOS_LOCALE || 'en') === 'en') {
  test('published iOS simulator app contains every reviewed animation asset', async ({}, info) => {
    const observed = packagedAnimations(await simulatorAppPath());
    await info.attach('packaged-animation-assets', { body: JSON.stringify(observed, null, 2), contentType: 'application/json' });
    expect(observed, '真实 iOS 发布包的动画素材、帧或时长已变化').toEqual(baseline.assets);
  });
}
