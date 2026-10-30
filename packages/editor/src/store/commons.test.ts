import { describe, expect, it } from 'vitest';
import { commonsLicense } from './commons';

describe('commonsLicense', () => {
  it('keeps licences that allow any use, with their version', () => {
    expect(commonsLicense('CC0')).toBe('CC0-1.0');
    expect(commonsLicense('Public domain')).toBe('Public Domain Mark');
    expect(commonsLicense('CC BY 3.0')).toBe('CC-BY-3.0');
    expect(commonsLicense('CC BY 3.0 de')).toBe('CC-BY-3.0');
    expect(commonsLicense('CC BY 4.0')).toBe('CC-BY-4.0');
  });
  it('leaves out share-alike, non-commercial and others', () => {
    expect(commonsLicense('CC BY-SA 4.0')).toBeNull();
    expect(commonsLicense('CC BY-NC 2.0')).toBeNull();
    expect(commonsLicense('GFDL')).toBeNull();
    expect(commonsLicense('')).toBeNull();
  });
});
