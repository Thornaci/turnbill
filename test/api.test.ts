import { describe, expect, it } from 'vitest';
import { isLocalHost } from '../server/api';

describe('isLocalHost', () => {
  it.each(['localhost', 'localhost:4317', '127.0.0.1:5173', '[::1]:4317'])('accepts %s', (h) => expect(isLocalHost(h)).toBe(true));
  it.each([undefined, '', 'evil.com', 'localhost.evil.com', '127.0.0.1.nip.io:4317', '192.168.1.5:4317'])('rejects %s', (h) => expect(isLocalHost(h)).toBe(false));
});
