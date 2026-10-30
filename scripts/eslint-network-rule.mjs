// AST matching: comments, strings and ordinary HTTP clients are not route calls.
const methods = new Set(['route', 'routeFromHAR', 'fulfill']);
function propertyName(node) {
  if (!node.computed) return node.property.name;
  if (node.property.type === 'TemplateLiteral' && node.property.expressions.length === 0) return node.property.quasis[0].value.cooked;
  return node.property.value;
}
function bindingDefinition(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);
    if (variable) return variable.defs[0]?.node;
  }
}
function calledMethod(node, scope) {
  if (node.type === 'MemberExpression') return propertyName(node);
  if (node.type !== 'Identifier') return;
  const binding = bindingDefinition(scope, node.name);
  if (binding?.type !== 'VariableDeclarator') return;
  if (binding.init?.type === 'MemberExpression') return propertyName(binding.init);
  if (binding.id.type !== 'ObjectPattern') return;
  const property = binding.id.properties.find(item => item.value?.name === node.name);
  return property && (property.key.name || property.key.value);
}
export const noNetworkFabrication = {
  meta: {
    type: 'problem', schema: [],
    messages: { forbidden: '禁止在 JS/TS 中新增网络响应伪造入口 {{method}}；响应实现应放在 Python 代理层。' },
  },
  create(context) {
    function checkDefinition(node) {
      if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(node.value?.type)) return;
      const name = node.key.name || node.key.value;
      if (methods.has(name)) context.report({ node, messageId: 'forbidden', data: { method: name } });
    }
    return {
      Property: checkDefinition,
      MethodDefinition: checkDefinition,
      PropertyDefinition: checkDefinition,
      CallExpression(node) {
        const name = calledMethod(node.callee, context.sourceCode.getScope(node));
        if (methods.has(name)) context.report({ node, messageId: 'forbidden', data: { method: name } });
      },
    };
  },
};
