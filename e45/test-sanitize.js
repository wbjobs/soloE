const GitService = require('./src/services/gitService');

const gitService = new GitService();

const testCases = [
  { input: 'Normal commit message', desc: '正常文本' },
  { input: 'feat: ✨ 添加新功能 🎉', desc: '包含emoji' },
  { input: 'fix: bug\x00fix', desc: '包含null字符' },
  { input: 'test\x01\x02\x03test', desc: '包含控制字符' },
  { input: 'docs: 更新文档 \x7F', desc: '包含DEL字符' },
  { input: 'refactor: 重构代码 \uFFFD\uFFFD', desc: '包含替换字符' },
  { input: 'chore: \x08\x0B\x0C 清理代码', desc: '包含其他控制字符' },
  { input: null, desc: 'null值' },
  { input: undefined, desc: 'undefined值' },
  { input: 12345, desc: '数字类型' },
  { input: {}, desc: '对象类型' },
];

console.log('测试sanitizeString函数:\n');
console.log('='.repeat(60));

testCases.forEach(({ input, desc }) => {
  const result = gitService.sanitizeString(input);
  console.log(`\n测试: ${desc}`);
  console.log(`  输入: ${JSON.stringify(input)}`);
  console.log(`  输出: ${JSON.stringify(result)}`);
  console.log(`  输出类型: ${typeof result}`);
});

console.log('\n' + '='.repeat(60));
console.log('\n所有测试完成!');
