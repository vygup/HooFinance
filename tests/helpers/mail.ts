export type TestMail = { to: string; subject: string; text: string };
export function createMailFixture() {
  const messages: TestMail[] = [];
  return {
    messages,
    async send(message: TestMail) {
      messages.push({ ...message });
    },
    clear() {
      messages.length = 0;
    },
  };
}
