import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
export async function invitationLink(email: string) {
  let link = '';
  await expect
    .poll(async () => {
      try {
        const { source } = JSON.parse(
          await readFile(
            join(
              process.env.E2E_MAIL_DIR!,
              createHash('sha256').update(email).digest('hex') + '.json',
            ),
            'utf8',
          ),
        ) as { source: string };
        const [head, ...parts] = source.split('\r\n\r\n');
        let text = parts.join('\r\n\r\n');
        if (/Content-Transfer-Encoding: base64/i.test(head!))
          text = Buffer.from(text, 'base64').toString('utf8');
        else
          text = text
            .replace(/=\r\n/g, '')
            .replace(/=([A-F0-9]{2})/g, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            );
        link = text.match(/https?:\/\/[^\s]+/)?.[0] ?? '';
        return !!link;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return link;
}
