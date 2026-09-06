// 验证前端生成是否真的替换了文字
const http = require('http');
const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ statusCode: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  // 1. 登录
  const loginBody = JSON.stringify({ email: 'mami@test.com', password: 'mami123' });
  const loginRes = await request({
    hostname: 'localhost', port: 3002, path: '/api/auth/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
  }, loginBody);
  const token = loginRes.data.data.token;

  // 2. API 生成 - 替换 layer_6 为 '测试替换文字123'
  const genBody = JSON.stringify({
    replaceData: {
      'layer_6': { type: 'text', content: '测试替换文字123' },
    }
  });
  const genRes = await request({
    hostname: 'localhost', port: 3002, path: '/api/template/7/generate', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(genBody),
      'Authorization': 'Bearer ' + token
    }
  }, genBody);

  const apiImgUrl = genRes.data.data.images[0].url;
  const apiFileName = path.basename(apiImgUrl);
  const apiGenPath = path.join(__dirname, 'uploads', 'render', apiFileName);
  const frontGenPath = path.join(__dirname, 'uploads', 'render', '1788423793074.png');

  console.log('API生成文件:', apiGenPath);
  console.log('前端生成文件:', frontGenPath);
  console.log('API文件大小:', fs.statSync(apiGenPath).size);
  console.log('前端文件大小:', fs.statSync(frontGenPath).size);

  // 3. 对比
  const [api, front] = await Promise.all([
    sharp(apiGenPath).raw().toBuffer({ resolveWithObject: true }),
    sharp(frontGenPath).raw().toBuffer({ resolveWithObject: true })
  ]);

  let diff = 0;
  const ad = api.data, fd = front.data;
  for (let i = 0; i < ad.length; i += 4) {
    if (Math.abs(ad[i]-fd[i]) + Math.abs(ad[i+1]-fd[i+1]) + Math.abs(ad[i+2]-fd[i+2]) > 30) diff++;
  }
  const total = ad.length / 4;
  console.log('\nAPI生成 vs 前端生成 差异:', diff, 'px =', (diff/total*100).toFixed(4)+'%');
  console.log('结论:', diff < 50 ? '完全一致 ✓（前端替换正确）' : '不一致 ✗（前端传值有问题）');

  // 4. 也看看API生成的图和无替换的差异，确认替换确实生效
  const noReplacePath = path.join(__dirname, 'uploads', 'test-replace', '1788442226170.png');
  const [noRep] = await Promise.all([
    sharp(noReplacePath).raw().toBuffer({ resolveWithObject: true })
  ]);
  let diffNoRep = 0;
  const nd = noRep.data;
  for (let i = 0; i < ad.length; i += 4) {
    if (Math.abs(ad[i]-nd[i]) + Math.abs(ad[i+1]-nd[i+1]) + Math.abs(ad[i+2]-nd[i+2]) > 30) diffNoRep++;
  }
  console.log('\nAPI生成 vs 无替换 差异:', diffNoRep, 'px =', (diffNoRep/total*100).toFixed(4)+'%');
  console.log('替换是否生效:', diffNoRep > 100 ? '是 ✓' : '否 ✗');
})().catch(e => console.error('ERROR:', e));
