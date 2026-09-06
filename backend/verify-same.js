const http = require('http');
const sharp = require('sharp');
const path = require('path');

function request(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : '';
    const options = {
      hostname: 'localhost',
      port: 3002,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(postData);
    req.end();
  });
}

async function measure(buf, color = 'white') {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minY=info.height, maxY=-1, minX=info.width, maxX=-1;
  for (let y=0; y<info.height; y++) {
    for (let x=0; x<info.width; x++) {
      const idx = (y*info.width+x)*4;
      const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
      if (a > 10) {
        if (color === 'white') {
          if (r > 200 && g > 200 && b > 200) {
            if (y<minY) minY=y;
            if (y>maxY) maxY=y;
            if (x<minX) minX=x;
            if (x>maxX) maxX=x;
          }
        } else {
          if (y<minY) minY=y;
          if (y>maxY) maxY=y;
          if (x<minX) minX=x;
          if (x>maxX) maxX=x;
        }
      }
    }
  }
  return {
    textW: maxX-minX+1, textH: maxY-minY+1,
    top: minY, left: minX, bottom: maxY, right: maxX
  };
}

async function main() {
  // 登录
  const loginRes = await request('POST', '/api/auth/login', {
    email: 'mami@test.com', password: 'mami123'
  });
  const token = loginRes.data.data?.token || loginRes.data.token;
  
  // 生成：汪涛替换成汪涛（同字对比）
  const genRes = await request('POST', '/api/template/16/generate', {
    sizeName: '原始尺寸',
    texts: [
      { 
        layerId: 'layer_7', 
        content: '汪涛',
        style: {
          fontFamily: 'SourceHanSansCN-Heavy',
          fontSize: 59,
          color: 'rgb(255, 255, 255)',
          textAlign: 'center',
          letterSpacing: 0
        }
      }
    ],
    images: []
  }, token);
  
  const url = genRes.data.data?.images[0]?.url;
  console.log('生成图片:', url);
  
  // 裁剪出汪涛位置
  const filePath = 'uploads/render/' + path.basename(url);
  const wangtaoCrop = await sharp(filePath)
    .extract({ left: 642, top: 1568, width: 150, height: 74 })
    .png()
    .toBuffer();
  
  // 原始图层
  const originalPath = 'uploads/layer-images/1788618989972-734240911.png';
  const origBuf = await sharp(originalPath).png().toBuffer();
  
  // 测量
  const mOrig = await measure(origBuf, 'white');
  const mNew = await measure(wangtaoCrop, 'white');
  
  console.log('\n===== 同字对比（汪涛 vs 汪涛） =====');
  console.log('PSD原始: ' + mOrig.textW + 'x' + mOrig.textH + ', top=' + mOrig.top + ', left=' + mOrig.left);
  console.log('SVG渲染: ' + mNew.textW + 'x' + mNew.textH + ', top=' + mNew.top + ', left=' + mNew.left);
  console.log('宽度差: ' + (mNew.textW - mOrig.textW) + 'px');
  console.log('高度差: ' + (mNew.textH - mOrig.textH) + 'px');
  console.log('顶部差: ' + (mNew.top - mOrig.top) + 'px');
  console.log('左边差: ' + (mNew.left - mOrig.left) + 'px');
  
  // 保存对比图
  const compareSvg = `<svg width="340" height="130" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#16213e"/>
    <text x="15" y="25" fill="#e94560" font-size="16" font-weight="bold" font-family="sans-serif">PSD 原始</text>
    <text x="195" y="25" fill="#00d9ff" font-size="16" font-weight="bold" font-family="sans-serif">SVG 渲染</text>
  </svg>`;
  
  const compareBuf = await sharp(Buffer.from(compareSvg))
    .composite([
      { input: origBuf, left: 10, top: 45 },
      { input: wangtaoCrop, left: 180, top: 45 }
    ])
    .png()
    .toBuffer();
  
  const comparePath = 'uploads/test-fix/compare_same_word.png';
  await sharp(compareBuf).png().toFile(comparePath);
  console.log('\n对比图:', comparePath);
}

main().catch(console.error);
