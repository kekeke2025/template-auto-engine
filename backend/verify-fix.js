const sharp = require('sharp');
const path = require('path');

async function main() {
  const generatedImg = 'uploads/render/1788625723778.png';
  const originalLayer = 'uploads/layer-images/1788618989972-734240911.png'; // 汪涛
  
  // 从生成图中裁剪出汪涛位置（x=642, y=1568, w=150, h=74）
  const wangtaoCrop = await sharp(generatedImg)
    .extract({ left: 642, top: 1568, width: 150, height: 74 })
    .png()
    .toBuffer();
  
  await sharp(wangtaoCrop).png().toFile('uploads/test-fix/gen_wangtao_crop.png');
  console.log('已裁剪生成图中的汪涛区域');
  
  // 也裁一下陈凤馨作为对比（原始图层，没有被替换）
  const chenfengxinCrop = await sharp(generatedImg)
    .extract({ left: 162, top: 1568, width: 223, height: 74 })
    .png()
    .toBuffer();
  await sharp(chenfengxinCrop).png().toFile('uploads/test-fix/gen_chenfengxin_crop.png');
  console.log('已裁剪生成图中的陈凤馨区域（原始，作为对照）');
  
  // 生成对比图
  const origBuf = await sharp(originalLayer).png().toBuffer();
  
  // 并排对比：左边原始图层，右边生成图裁剪（四三）
  // 宽度 150*2 + 20 = 320，高度 74 + 40 = 114
  const compareSvg = `<svg width="320" height="114" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1a1a2e"/>
    <text x="10" y="18" fill="white" font-size="14" font-family="sans-serif">PSD原始(汪涛)</text>
    <text x="180" y="18" fill="white" font-size="14" font-family="sans-serif">SVG替换(四三)</text>
  </svg>`;
  
  const compareBuf = await sharp(Buffer.from(compareSvg))
    .composite([
      { input: origBuf, left: 10, top: 30 },
      { input: wangtaoCrop, left: 180, top: 30 }
    ])
    .png()
    .toBuffer();
  
  await sharp(compareBuf).png().toFile('uploads/test-fix/compare_wangtao.png');
  console.log('对比图已保存: uploads/test-fix/compare_wangtao.png');
  
  // 精确测量两者的文字像素大小
  async function measure(buf) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minY=info.height, maxY=-1, minX=info.width, maxX=-1;
    for (let y=0; y<info.height; y++) {
      for (let x=0; x<info.width; x++) {
        const idx = (y*info.width+x)*4;
        // 只统计亮色像素（白字）
        const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
        if (a > 10 && r > 200 && g > 200 && b > 200) {
          if (y<minY) minY=y;
          if (y>maxY) maxY=y;
          if (x<minX) minX=x;
          if (x>maxX) maxX=x;
        }
      }
    }
    return {
      textW: maxX-minX+1,
      textH: maxY-minY+1,
      top: minY, left: minX
    };
  }
  
  const m1 = await measure(origBuf);
  const m2 = await measure(wangtaoCrop);
  
  console.log('\n===== 像素级对比 =====');
  console.log('PSD原始(汪涛): ' + m1.textW + 'x' + m1.textH + ', top=' + m1.top + ', left=' + m1.left);
  console.log('SVG替换(四三): ' + m2.textW + 'x' + m2.textH + ', top=' + m2.top + ', left=' + m2.left);
  console.log('高度差: ' + (m2.textH - m1.textH) + 'px');
  console.log('顶部位置差: ' + (m2.top - m1.top) + 'px');
  
  // 注意："四三"和"汪涛"字数一样都是2字，但字宽可能不同
  console.log('\n注："四三"和"汪涛"是不同的字，宽度不同是正常的。主要对比高度和顶部位置。');
  
  // 再做一个更公平的对比：用同样的字"汪涛"
  console.log('\n生成"汪涛"替换"汪涛"对比（同字对比更准）...');
}

main().catch(console.error);
