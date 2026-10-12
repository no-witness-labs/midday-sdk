import { describe, expect, it } from 'vitest';
import * as Hash from '../src/Hash.js';

describe('Hash.stringToBytes32', () => {
  it('pads short input and refuses input longer than 32 bytes', () => {
    const short = Hash.stringToBytes32('secret');
    expect(short.length).toBe(32);
    expect(Buffer.from(short.subarray(0, 6)).toString()).toBe('secret');

    // Truncation would give these two the same commitment.
    const long = 'a'.repeat(33);
    expect(() => Hash.stringToBytes32(long)).toThrow(RangeError);
    expect(() => Hash.password('x'.repeat(32) + 'y')).toThrow(/at most 32/);
    expect(Hash.stringToBytes32('é'.repeat(16)).length).toBe(32); // 32 bytes of UTF-8 exactly
    expect(() => Hash.stringToBytes32('é'.repeat(17))).toThrow(RangeError);
  });
});
