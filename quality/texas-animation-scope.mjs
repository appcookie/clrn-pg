// Test support keeps the same ceiling as its tests, regardless of suffix.
export const texasAnimationFiles = [
  'ios/full/texas-{action-region,action-start,card-region,control-variants,hall,panel-variants,panels,raise-masks,raise-region,record-variants,showdown-region,table-variants}{,.*}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}',
  'ios/full/texas-animation*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}',
  'quality/texas-animation.test.mjs',
];
export const texasAnimationTools = [
  'eslint.config.mjs', 'quality/texas-animation-scope.mjs',
  'scripts/check-texas-animation.mjs', 'scripts/measure-texas-animation.mjs',
];
