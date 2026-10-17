// Private SMTP fixture: no production route, mailbox endpoint, or real delivery.
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const mailDir = process.env.E2E_MAIL_DIR;
if (!mailDir) throw new Error('E2E_MAIL_DIR_REQUIRED');
const smtp = createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 localhost E2E SMTP\r\n');
  let buffer = '',
    recipient = '',
    data = false,
    source = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (data) {
        if (line !== '.') {
          source += line.replace(/^\.\./, '.') + '\r\n';
          continue;
        }
        data = false;
        const filename =
          createHash('sha256').update(recipient).digest('hex') + '.json';
        void writeFile(
          join(mailDir, filename),
          JSON.stringify({ recipient, source }),
          { mode: 0o600 },
        ).then(
          () => socket.write('250 Accepted\r\n'),
          () => socket.write('451 Fixture write failed\r\n'),
        );
      } else if (/^EHLO|^HELO/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.match(/<([^>]+)>/)?.[1] ?? '';
        socket.write('250 OK\r\n');
      } else if (/^DATA$/i.test(line)) {
        data = true;
        source = '';
        socket.write('354 End with dot\r\n');
      } else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const address = smtp.address();
if (!address || typeof address === 'string') throw new Error('SMTP_ADDRESS');
const child = spawn(
  'pnpm',
  ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '3100'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(address.port),
      SMTP_SECURE: 'false',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    },
  },
);
function stop() {
  child.kill('SIGTERM');
  smtp.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  smtp.close();
  process.exit(code ?? 0);
});
