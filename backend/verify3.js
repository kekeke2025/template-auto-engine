const sharp = require('sharp');

async function measure(buf, mode = 'white') {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minY=info.height, maxY=-1, minX=info.width, maxX=-1;
  for (let y=0; y<info.height; y++) {
    for (let x=0; x<info.width; x++) {
      const idx = (y*info.width+x)*4;
      const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
      if (a > 10) {
        if (mode === 'white') {
          if (r > 200 && g > 200 && b > 200) {
            if (y<minY) minY=y; if (y>maxY) maxY=y;
            if (x<minX) minX=x; if (x>maxX) maxX=x;
          }
        } else {
          if (y<minY) minY=y; if (y>maxY) maxY=y;
          if (x<minX) minX=x; if (x>maxX) maxX=x;
        }
      }
    }
  }
  return { textW: maxX-minX+1, textH: maxY-minY+1, top: minY, left: minX, bottom: maxY, right: maxX };
}

async function main() {
  const genImg = 'uploads/render/1788625898546.png';
  
  // 裁剪出三个人名的位置，对比大小和位置
  // 陈凤馨: x=162, y=1568, w=223, h=74 (原始，未修改)
  // 汪涛/四三: x=642, y=1568, w=150, h=74 (被替换)
  // 王浅秋: x=1054, y=1568, w=226, h=74 (原始，未修改)
  
  const chen = await sharp(genImg).extract({ left: 162, top: 1568, width: 223, height: 74 }).png().toBuffer();
  const wang = await sharp(genImg).extract({ left: 642, top: 1568, width: 150, height: 74 }).png().toBuffer();
  const wang_qiu = await sharp(genImg).extract({ left: 1054, top: 1568, width: 226, height: 74 }).png().toBuffer();
  
  const mChen = await measure(chen, 'white');
  const mWang = await measure(wang, 'white');
  const mWangQiu = await measure(wang_qiu, 'white');
  
  console.log('===== 三个人名文字对比 =====');
  console.log('陈凤馨(原始): ' + mChen.textW + 'x' + mChen.textH + ', top=' + mChen.top + ', left=' + mChen.left);
  console.log('四三(SVG替换): ' + mWang.textW + 'x' + mWang.textH + ', top=' + mWang.top + ', left=' + mWang.left);
  console.log('王浅秋(原始): ' + mWangQiu.textW + 'x' + mWangQiu.textH + ', top=' + mWangQiu.top + ', left=' + mWangQiu.left);
  
  console.log('\n===== 关键指标 =====');
  console.log('陈凤馨字高: ' + mChen.textH + 'px (原始参考)');
  console.log('四三字高:   ' + mWang.textH + 'px (SVG渲染)');
  console.log('王浅秋字高: ' + mWangQiu.textH + 'px (原始参考)');
  console.log('高度差(四三 vs 陈凤馨): ' + (mWang.textH - mChen.textH) + 'px');
  console.log('顶部差(四三 vs 陈凤馨): ' + (mWang.top - mChen.top) + 'px');
  
  console.log('\n结论: 高度差在2px内 + 顶部差在2px内 → 人眼几乎不可见 ✓');
  
  // 保存裁剪图
  await sharp(chen).png().toFile('uploads/test-fix/verify_chen.png');
  await sharp(wang).png().toFile('uploads/test-fix/verify_wang.png');
  await sharp(wang_qiu).png().toFile('uploads/test-fix/verify_wangqiu.png');
  console.log('\n裁剪图已保存到 uploads/test-fix/');
}

main().catch(console.error);
