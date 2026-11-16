import { describe, expect, it } from 'vitest';
import { isPublicIPv4, isSafeHttpsUrl, safeHttpsRequest } from '../backend/src/config/safeHttpsRequest.ts';

describe('outbound URL address guard', () => {
  it('accepts public IPv4 addresses', () => {
    expect(isPublicIPv4('8.8.8.8')).toBe(true);
    expect(isPublicIPv4('1.1.1.1')).toBe(true);
  });

  it('rejects private, local, reserved, and invalid addresses', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '224.0.0.1', 'not-an-ip']) {
      expect(isPublicIPv4(address)).toBe(false);
    }
  });
});

describe('safe outbound HTTPS requests', () => {
  it('only accepts HTTPS URLs without embedded credentials or custom ports', () => {
    expect(isSafeHttpsUrl('https://hooks.example.com/path')).toBe(true);
    expect(isSafeHttpsUrl('http://hooks.example.com/path')).toBe(false);
    expect(isSafeHttpsUrl('https://user:pass@hooks.example.com/path')).toBe(false);
    expect(isSafeHttpsUrl('https://hooks.example.com:8443/path')).toBe(false);
    expect(isSafeHttpsUrl('not a URL')).toBe(false);
  });

  it('refuses loopback destinations without connecting', async () => {
    await expect(safeHttpsRequest('https://127.0.0.1/')).resolves.toBeNull();
  });
});