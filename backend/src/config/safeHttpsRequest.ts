import { lookup } from 'dns/promises';
import https from 'https';
import net from 'net';

export interface SafeHttpsResult {
  statusCode: number;
  body: Buffer;
}

interface SafeHttpsOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const NON_PUBLIC_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

export function isPublicIPv4(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const octets = address.split('.').map(Number);
  const value = (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
  return NON_PUBLIC_IPV4_RANGES.every(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((value & mask) >>> 0) !== network;
  });
}

export function isSafeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443');
  } catch {
    return false;
  }
}

export async function safeHttpsRequest(url: string, options: SafeHttpsOptions = {}): Promise<SafeHttpsResult | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!isSafeHttpsUrl(url)) {
    return null;
  }

  try {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    const ipv4 = addresses.filter((address) => address.family === 4).map((address) => address.address);
    if (ipv4.length === 0 || ipv4.some((address) => !isPublicIPv4(address))) return null;
    const pinnedAddress = ipv4[0];

    return await new Promise((resolve) => {
      const request = https.request(
        {
          hostname: parsed.hostname,
          port: 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: options.method || 'GET',
          headers: options.headers,
          servername: parsed.hostname,
          lookup: (_hostname, _lookupOptions, callback) => callback(null, pinnedAddress, 4),
        },
        (response) => {
          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          const maxBytes = options.maxResponseBytes ?? 64 * 1024;
          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxBytes) {
              request.destroy();
              resolve(null);
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ statusCode: response.statusCode || 0, body: Buffer.concat(chunks) }));
          response.on('error', () => resolve(null));
        }
      );

      request.setTimeout(options.timeoutMs ?? 4000, () => request.destroy(new Error('Request timed out')));
      request.on('error', () => resolve(null));
      if (options.body) request.write(options.body);
      request.end();
    });
  } catch {
    return null;
  }
}