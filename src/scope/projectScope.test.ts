import { describe, it, expect } from 'vitest';
import {
  createProjectScope,
  formatAllowedProjects,
  normalizeProjectKey,
  parseAllowedProjects,
} from './projectScope.js';

describe('parseAllowedProjects', () => {
  it('splits on commas and upper-cases', () => {
    expect(parseAllowedProjects('pbl,Infra')).toEqual(['PBL', 'INFRA']);
  });

  it('tolerates whitespace and blank entries', () => {
    expect(parseAllowedProjects(' PBL , , INFRA ,')).toEqual(['PBL', 'INFRA']);
  });

  it('splits on whitespace too', () => {
    expect(parseAllowedProjects('PBL INFRA')).toEqual(['PBL', 'INFRA']);
  });

  it('accepts a pre-split array (env-var asArray)', () => {
    expect(parseAllowedProjects(['pbl', 'infra'])).toEqual(['PBL', 'INFRA']);
  });

  it('de-duplicates', () => {
    expect(parseAllowedProjects('PBL,pbl,PBL')).toEqual(['PBL']);
  });
});

describe('createProjectScope', () => {
  // The server refuses to start when this returns undefined, so every input
  // that means "nothing was configured" has to land here rather than producing
  // an empty-but-present scope, which would read as "no restriction".
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
    ['separators only', ' , , '],
    ['empty array', []],
    ['array of blanks', ['', '  ']],
  ])('returns undefined for %s', (_label, input) => {
    expect(createProjectScope(input as never)).toBeUndefined();
  });

  it('returns a scope for a real key', () => {
    expect(createProjectScope('pbl')).toEqual({ keys: ['PBL'] });
  });
});

describe('helpers', () => {
  it('normalizes a key', () => {
    expect(normalizeProjectKey('  pbl ')).toBe('PBL');
  });

  it('formats the allow-list for messages', () => {
    expect(formatAllowedProjects({ keys: ['PBL', 'INFRA'] })).toBe(
      'PBL, INFRA'
    );
  });
});
