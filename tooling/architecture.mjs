const serverImport =
  /(^|\/)server(\/|$)|(^|\/)(infrastructure|application)(\/|$)|^(pg|drizzle-orm|better-auth)(\/|$)|^node:/;
export const clientBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      boundary:
        'Клиентский модуль не может импортировать серверный код. Используйте разрешённый transport и безопасные DTO.',
    },
  },
  create(context) {
    let client = false;
    return {
      Program(node) {
        client = node.body.some(
          (item) =>
            item.type === 'ExpressionStatement' &&
            item.directive === 'use client',
        );
      },
      ImportDeclaration(node) {
        if (
          client &&
          node.importKind !== 'type' &&
          serverImport.test(node.source.value)
        )
          context.report({ node, messageId: 'boundary' });
      },
      ImportExpression(node) {
        if (
          client &&
          (node.source.type !== 'Literal' ||
            serverImport.test(node.source.value))
        )
          context.report({ node, messageId: 'boundary' });
      },
    };
  },
};
export const rules = { 'client-boundary': clientBoundary };
