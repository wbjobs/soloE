#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ModelLoader = require('../server/modelLoader');
const DiffCalculator = require('../server/diffCalculator');

function printUsage() {
  console.log(`
3D模型差异比较工具 - 命令行版

使用方法:
  node cli/diff-cli.js <模型1路径> <模型2路径> [选项]

选项:
  --no-icp          禁用配准
  --align <method>  配准方法: icp (默认) 或 simple (平移+缩放)
  --samples <n>     顶点采样数量 (默认: 10000)
  --output <file>   将结果输出到JSON文件
  --top <n>         显示前N个差异最大的顶点 (默认: 5)
  --no-progress     禁用进度显示
  --help, -h        显示帮助信息

支持的格式: OBJ, GLTF, GLB

示例:
  node cli/diff-cli.js model1.obj model2.glb
  node cli/diff-cli.js model1.obj model2.obj --no-icp --top 10
  node cli/diff-cli.js a.glb b.glb --align simple --samples 50000
  node cli/diff-cli.js a.glb b.glb --samples 5000 --output result.json
  `);
}

function parseArgs(args) {
  const options = {
    useICP: true,
    alignMethod: 'icp',
    sampleCount: 10000,
    topN: 5,
    output: null,
    showProgress: true,
    files: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      case '--no-icp':
        options.useICP = false;
        break;
      case '--align':
        options.alignMethod = args[++i];
        if (!['icp', 'simple'].includes(options.alignMethod)) {
          console.error('错误: --align 参数必须是 "icp" 或 "simple"');
          process.exit(1);
        }
        break;
      case '--samples':
        options.sampleCount = parseInt(args[++i]);
        if (isNaN(options.sampleCount) || options.sampleCount < 1) {
          console.error('错误: --samples 需要一个正整数参数');
          process.exit(1);
        }
        break;
      case '--top':
        options.topN = parseInt(args[++i]);
        if (isNaN(options.topN) || options.topN < 1) {
          console.error('错误: --top 需要一个正整数参数');
          process.exit(1);
        }
        break;
      case '--output':
        options.output = args[++i];
        if (!options.output) {
          console.error('错误: --output 需要一个文件路径参数');
          process.exit(1);
        }
        break;
      case '--no-progress':
        options.showProgress = false;
        break;
      default:
        if (!arg.startsWith('--')) {
          options.files.push(arg);
        }
        break;
    }
  }

  return options;
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0.000000';
  if (Math.abs(num) < 0.001 && num !== 0) {
    return num.toExponential(4);
  }
  return num.toFixed(6);
}

function printResults(result, topN, options) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 3D 模型差异比较结果');
  console.log('='.repeat(70));

  console.log('\n📁 模型信息:');
  console.log(`  模型1: ${result.model1.path}`);
  console.log(`    - 顶点数: ${result.model1.vertexCount.toLocaleString()}`);
  console.log(`    - 面片数: ${result.model1.faceCount.toLocaleString()}`);
  console.log(`  模型2: ${result.model2.path}`);
  console.log(`    - 顶点数: ${result.model2.vertexCount.toLocaleString()}`);
  console.log(`    - 面片数: ${result.model2.faceCount.toLocaleString()}`);

  console.log('\n⚙️  配置:');
  console.log(`  配准: ${result.usedICP ? '✅ 已启用' : '❌ 已禁用'}`);
  if (result.usedICP) {
    console.log(`  配准方法: ${result.alignMethod === 'simple' ? '平移+缩放' : 'ICP (平移+旋转)'}`);
  }
  console.log(`  采样点数: ${result.stats.sampledCount1.toLocaleString()}`);

  console.log('\n📈 统计数据:');
  console.log(`  最小差异: ${formatNumber(result.stats.minDistance)}`);
  console.log(`  最大差异: ${formatNumber(result.stats.maxDistance)}`);
  console.log(`  平均差异: ${formatNumber(result.stats.meanDistance)}`);

  console.log(`\n📍 差异最大的 ${topN} 个顶点:`);
  console.log('-'.repeat(70));
  console.log('  排名  索引      X            Y            Z            差异值');
  console.log('-'.repeat(70));

  const topDiffs = result.topDifferences.slice(0, topN);
  topDiffs.forEach((diff, index) => {
    const rank = String(index + 1).padStart(2);
    const idx = String(diff.index).padStart(6);
    const x = formatNumber(diff.vertex[0]).padStart(12);
    const y = formatNumber(diff.vertex[1]).padStart(12);
    const z = formatNumber(diff.vertex[2]).padStart(12);
    const dist = formatNumber(diff.distance).padStart(14);
    
    const colorCode = index < 3 ? '\x1b[31m' : '\x1b[33m';
    const resetCode = '\x1b[0m';
    
    console.log(`  ${rank}   ${idx}  ${x}  ${y}  ${z}  ${colorCode}${dist}${resetCode}`);
  });

  console.log('-'.repeat(70));
  console.log('\n💡 颜色说明: 红色 = 差异极大, 黄色 = 差异较大, 绿色 = 差异极小');
  console.log('='.repeat(70) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.files.length !== 2) {
    console.error('错误: 需要提供两个模型文件路径');
    printUsage();
    process.exit(1);
  }

  const [path1, path2] = options.files;

  if (!fs.existsSync(path1)) {
    console.error(`错误: 文件不存在: ${path1}`);
    process.exit(1);
  }
  if (!fs.existsSync(path2)) {
    console.error(`错误: 文件不存在: ${path2}`);
    process.exit(1);
  }

  try {
    let lastProgress = -1;
    
    console.log(`\n⏳ 正在加载模型...`);
    const loader = new ModelLoader();
    const model1 = loader.load(path1);
    const model2 = loader.load(path2);

    console.log(`✅ 模型加载完成`);
    console.log(`  模型1: ${model1.vertices.length.toLocaleString()} 个顶点, ${model1.faces.length.toLocaleString()} 个面片`);
    console.log(`  模型2: ${model2.vertices.length.toLocaleString()} 个顶点, ${model2.faces.length.toLocaleString()} 个面片`);

    const alignText = options.useICP 
      ? (options.alignMethod === 'simple' ? ' (平移+缩放配准中...)' : ' (ICP配准中...)')
      : '';
    console.log(`\n⏳ 正在计算差异${alignText}...`);
    
    const calculator = new DiffCalculator();
    
    if (options.showProgress) {
      calculator.setProgressCallback((progress) => {
        if (progress.percent > lastProgress) {
          lastProgress = progress.percent;
          const barWidth = 30;
          const filled = Math.round((progress.percent / 100) * barWidth);
          const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
          process.stdout.write(`\r  进度: [${bar}] ${progress.percent}% - ${progress.message}`);
        }
      });
    }
    
    const result = calculator.calculate(model1, model2, {
      sampleCount: options.sampleCount,
      useICP: options.useICP,
      alignMethod: options.alignMethod
    });

    if (options.showProgress) {
      process.stdout.write('\n');
    }

    console.log(`✅ 计算完成`);

    const output = {
      model1: {
        path: path.resolve(path1),
        vertexCount: model1.vertices.length,
        faceCount: model1.faces.length
      },
      model2: {
        path: path.resolve(path2),
        vertexCount: model2.vertices.length,
        faceCount: model2.faces.length
      },
      stats: result.stats,
      topDifferences: result.topDifferences.slice(0, options.topN).map(d => ({
        index: d.index,
        vertex: d.vertex,
        distance: d.distance
      })),
      usedICP: options.useICP,
      alignMethod: options.alignMethod
    };

    printResults(output, options.topN, options);

    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(output, null, 2));
      console.log(`📄 结果已保存到: ${path.resolve(options.output)}`);
    }

  } catch (error) {
    console.error('\n❌ 处理失败:');
    console.error(`  ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
