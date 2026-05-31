const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

async function testTimelineAPI() {
  try {
    const form = new FormData();
    
    const files = ['test_v1.obj', 'test_v2.obj', 'test_v3.obj'];
    for (const file of files) {
      const filePath = path.join(__dirname, file);
      form.append('models', fs.createReadStream(filePath));
    }
    
    form.append('baseVersion', '0');
    form.append('alignMethod', 'simple');
    form.append('sampleCount', '1000');

    const response = await axios.post('http://localhost:3001/api/compare-timeline', form, {
      headers: form.getHeaders(),
      timeout: 300000,
      maxBodyLength: Infinity
    });

    console.log('✅ API 调用成功！');
    console.log('\n📊 结果摘要:');
    console.log(`  版本数量: ${response.data.totalVersions}`);
    console.log(`  基准版本: ${response.data.baseVersion}`);
    console.log(`  配准方法: ${response.data.alignMethod}`);
    
    console.log('\n📈 RMS 趋势:');
    response.data.rmsTrend.forEach((item, i) => {
      console.log(`  V${i + 1} (${item.versionName}): ${item.rms.toExponential(6)}`);
    });

    console.log('\n⏱️  时间轴数据:');
    response.data.timeline.forEach((item, i) => {
      console.log(`  V${i + 1}: max=${item.stats.maxDistance.toExponential(4)}, mean=${item.stats.meanDistance.toExponential(4)}, topDiff=${item.topDifferences.length}个顶点`);
      if (item.topDifferences.length > 0) {
        console.log(`    最大差异: 顶点${item.topDifferences[0].index} = ${item.topDifferences[0].distance.toExponential(4)}`);
      }
    });

    console.log('\n✅ 所有数据格式正确！');
  } catch (error) {
    console.error('❌ API 调用失败:', error.message);
    if (error.response) {
      console.error('响应:', error.response.data);
    }
  }
}

testTimelineAPI();
