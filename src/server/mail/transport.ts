import 'server-only';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { getConfig } from '@/server/config';
const mailSchema = z.strictObject({
  to: z.email(),
  subject: z
    .string()
    .min(1)
    .refine((v) => !/[\r\n]/.test(v)),
  text: z.string().min(1),
});
export type MailMessage = z.infer<typeof mailSchema>;
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
export function createMockMailTransport() {
  const messages: MailMessage[] = [];
  return {
    messages,
    async send(message: MailMessage) {
      messages.push(mailSchema.parse(message));
    },
    clear() {
      messages.length = 0;
    },
  };
}
let transport: MailTransport | undefined;
export function getMailTransport(): MailTransport {
  if (!transport) {
    const c = getConfig();
    if (c.MAIL_TRANSPORT === 'mock') {
      transport = createMockMailTransport();
      return transport;
    }
    const smtp = nodemailer.createTransport({
      host: c.SMTP_HOST,
      port: c.SMTP_PORT,
      secure: c.SMTP_SECURE,
      requireTLS: c.NODE_ENV === 'production' && !c.SMTP_SECURE,
      auth: c.SMTP_USER
        ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 10000,
      logger: false,
      debug: false,
    });
    transport = {
      async send(message) {
        const data = mailSchema.parse(message);
        try {
          await smtp.sendMail({
            ...data,
            from: c.SMTP_FROM,
            disableFileAccess: true,
            disableUrlAccess: true,
          });
        } catch {
          throw new Error('MAIL_DELIVERY_FAILED');
        }
      },
    };
  }
  return transport;
}
