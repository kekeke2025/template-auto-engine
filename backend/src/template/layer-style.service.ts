import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
import * as fs from 'fs';
import * as path from 'path';
import { LayerStyle } from './image-render.service';

function debugLog(...args: any[]) {
  const msg = '[STYLE_DEBUG] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console.log(msg);
  try {
    fs.appendFileSync(path.join(process.cwd(), 'style-debug.log'), msg + '\n');
  } catch (e) {}
}

/**
 * PS 混合模式 → sharp blend 模式映射
 * sharp 支持的 blend 模式：clear, source, over, in, out, atop, dest, dest-over,
 * dest-in, dest-out, dest-atop, xor, add, saturate, multiply, screen, overlay,
 * darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference,
 * exclusion
 */
const BLEND_MODE_MAP: Record<string, string> = {
  'normal': 'over',
  'pass through': 'over', // 组的穿透模式，等同于 normal
  'multiply': 'multiply',
  'screen': 'screen',
  'overlay': 'overlay',
  'darken': 'darken',
  'lighten': 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  'difference': 'difference',
  'exclusion': 'exclusion',
  'linear dodge': 'add', // linear dodge ≈ add
  'darker color': 'darken',
  'lighter color': 'lighten',
  'dissolve': 'over', // 近似处理
  'hard mix': 'overlay', // 近似
  'vivid light': 'color-burn', // 近似
  'linear light': 'linear dodge', // 近似
  'pin light': 'lighten', // 近似
  // 色相/饱和度/颜色/明度这些色彩混合模式 sharp 不支持，近似用 over
  'hue': 'over',
  'saturation': 'over',
  'color': 'over',
  'luminosity': 'over',
  'subtract': 'difference', // 近似
  'divide': 'color-dodge', // 近似
};

@Injectable()
export class LayerStyleService {
  /**
   * 获取 sharp 支持的 blend 模式
   */
  getSharpBlendMode(psBlendMode: string | undefined): string {
    if (!psBlendMode) return 'over';
    return BLEND_MODE_MAP[psBlendMode.toLowerCase()] || 'over';
  }

  /**
   * 应用全部图层样式到图层图片
   * 按 PS 渲染顺序：外发光 → 投影 → 描边 → 内阴影 → 内发光 → 光泽 → 颜色叠加 → 渐变叠加 → 图案叠加 → 斜面浮雕
   * 返回应用样式后的图片和相对原图的偏移（外发光/投影会扩展画布）
   */
  async applyLayerStyles(
    layerBuffer: Buffer,
    style: LayerStyle | undefined,
    layerW: number,
    layerH: number,
  ): Promise<{ buffer: Buffer; offsetX: number; offsetY: number; width: number; height: number }> {
    debugLog('applyLayerStyles called, style keys=', style ? Object.keys(style).join(',') : 'undefined');
    if (!style) {
      return { buffer: layerBuffer, offsetX: 0, offsetY: 0, width: layerW, height: layerH };
    }

    let result = layerBuffer;
    let offsetX = 0;
    let offsetY = 0;
    let currentW = layerW;
    let currentH = layerH;
    debugLog('  initial size:', currentW, 'x', currentH);

    // 先应用填充不透明度（fillOpacity 只影响图层内容，不影响样式）
    if (style.fillOpacity != null && style.fillOpacity < 1) {
      result = await this.applyFillOpacity(result, style.fillOpacity);
    }

    // 1. 外发光（在图层下面，会扩展画布）
    if (style.outerGlow?.enabled) {
      debugLog('  -> applying outer glow, size=', style.outerGlow.size, 'color=', style.outerGlow.color);
      const glowResult = await this.applyOuterGlow(result, style.outerGlow, currentW, currentH);
      result = glowResult.buffer;
      offsetX += glowResult.offsetX;
      offsetY += glowResult.offsetY;
      currentW = glowResult.width;
      currentH = glowResult.height;
      debugLog('     outer glow done, size now:', currentW, 'x', currentH, 'offsetX:', glowResult.offsetX, 'offsetY:', glowResult.offsetY);
    }

    // 2. 投影（在图层下面，会扩展画布）
    if (style.dropShadow && style.dropShadow.length > 0) {
      // 从后往前画（最远的投影先画，最近的最后画）
      for (let i = style.dropShadow.length - 1; i >= 0; i--) {
        const shadow = style.dropShadow[i];
        if (shadow.enabled) {
          debugLog('  -> applying dropShadow #' + i, 'distance=' + shadow.distance, 'size=' + shadow.size, 'spread=' + shadow.spread, 'angle=' + shadow.angle, 'color=' + shadow.color);
          const shadowResult = await this.applyDropShadow(result, shadow, currentW, currentH);
          result = shadowResult.buffer;
          offsetX += shadowResult.offsetX;
          offsetY += shadowResult.offsetY;
          currentW = shadowResult.width;
          currentH = shadowResult.height;
          debugLog('     dropShadow done, size now:', currentW, 'x', currentH, 'offsetX:', shadowResult.offsetX, 'offsetY:', shadowResult.offsetY);
        }
      }
    }

    // 3. 描边
    if (style.stroke && style.stroke.length > 0) {
      for (const stroke of style.stroke) {
        if (stroke.enabled) {
          debugLog('  -> applying stroke, position=' + stroke.position, 'size=' + stroke.size, 'color=' + stroke.color, 'fillType=' + stroke.fillType);
          const strokeResult = await this.applyStroke(result, stroke, currentW, currentH);
          result = strokeResult.buffer;
          // 外描边会扩展画布，内描边不会，居中可能会扩展一点点
          if (strokeResult.expanded) {
            offsetX += strokeResult.offsetX;
            offsetY += strokeResult.offsetY;
            currentW = strokeResult.width;
            currentH = strokeResult.height;
          }
          debugLog('     stroke done, expanded=' + strokeResult.expanded + ', size now:', currentW, 'x', currentH);
        }
      }
    }

    // 4. 内阴影（不扩展画布）
    if (style.innerShadow && style.innerShadow.length > 0) {
      for (let i = style.innerShadow.length - 1; i >= 0; i--) {
        const shadow = style.innerShadow[i];
        if (shadow.enabled) {
          result = await this.applyInnerShadow(result, shadow, currentW, currentH);
        }
      }
    }

    // 5. 内发光（不扩展画布）
    if (style.innerGlow?.enabled) {
      result = await this.applyInnerGlow(result, style.innerGlow, currentW, currentH);
    }

    // 6. 颜色叠加（不扩展画布）
    if (style.colorOverlay && style.colorOverlay.length > 0) {
      for (const overlay of style.colorOverlay) {
        if (overlay.enabled) {
          result = await this.applyColorOverlay(result, overlay);
        }
      }
    }

    // 7-10. 渐变叠加、图案叠加、光泽、斜面浮雕（后续实现）
    // ...

    return { buffer: result, offsetX, offsetY, width: currentW, height: currentH };
  }

  /**
   * 应用填充不透明度（只影响图层内容，不影响样式）
   */
  private async applyFillOpacity(buffer: Buffer, fillOpacity: number): Promise<Buffer> {
    // 用 dest-in 混合一张带透明度的白色图
    return sharp(buffer)
      .composite([{
        input: Buffer.from([255, 255, 255, Math.round(fillOpacity * 255)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      }])
      .png()
      .toBuffer();
  }

  /**
   * 应用颜色叠加
   * 原理：生成一张和图层同样大小的纯色图，用 alpha 通道做遮罩，然后按 blendMode 混合
   */
  private async applyColorOverlay(
    buffer: Buffer,
    overlay: { color: string; blendMode: string; opacity: number },
  ): Promise<Buffer> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (!w || !h) return buffer;

      // 生成纯色图（带透明度）
      const colorWithAlpha = this.parseColorToRgba(overlay.color, overlay.opacity);

      const colorBuffer = await sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: colorWithAlpha,
        },
      }).png().toBuffer();

      // 混合模式
      const blend = this.getSharpBlendMode(overlay.blendMode);

      // 先把颜色层按图层的 alpha 做遮罩（只在图层内容区域显示叠加）
      // 用 dest-in：目标 = 颜色层 * 图层 alpha
      const maskedColor = await sharp(colorBuffer)
        .composite([{
          input: buffer,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();

      // 再把遮罩后的颜色层混合到图层上
      return sharp(buffer)
        .composite([{
          input: maskedColor,
          blend,
        }])
        .png()
        .toBuffer();
    } catch (e) {
      debugLog('颜色叠加失败:', e.message);
      return buffer;
    }
  }

  /**
   * 应用投影
   * 原理：
   * 1. 提取图层 alpha 通道作为影子形状
   * 2. 填充影子颜色
   * 3. 高斯模糊
   * 4. 按角度和距离偏移
   * 5. 放到图层下面，按 blendMode 混合
   */
  private async applyDropShadow(
    buffer: Buffer,
    shadow: {
      color: string;
      blendMode: string;
      opacity: number;
      angle: number;
      distance: number;
      size: number;
      spread: number;
    },
    layerW: number,
    layerH: number,
  ): Promise<{ buffer: Buffer; offsetX: number; offsetY: number; width: number; height: number }> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || layerW;
      const h = meta.height || layerH;
      if (!w || !h) return { buffer, offsetX: 0, offsetY: 0, width: w, height: h };

      // 计算偏移量（PS 角度：0° 向上为正，顺时针转）
      const angleRad = (90 - shadow.angle) * Math.PI / 180;
      const offsetX = Math.round(Math.cos(angleRad) * shadow.distance);
      const offsetY = -Math.round(Math.sin(angleRad) * shadow.distance);

      // spread 扩展的像素量
      const spreadAmount = (shadow.spread || 0) / 100;
      const spreadPx = spreadAmount > 0 && shadow.size > 0
        ? Math.max(1, Math.round(shadow.size * spreadAmount))
        : 0;

      // 模糊半径
      const blurSize = shadow.size * (1 - spreadAmount);
      const blurSigma = blurSize > 0 ? Math.max(0.1, blurSize / 2) : 0;

      // 计算大画布尺寸（给膨胀、模糊、偏移留出空间）
      const padLeft = Math.max(0, -offsetX) + spreadPx + Math.ceil(blurSigma * 3);
      const padTop = Math.max(0, -offsetY) + spreadPx + Math.ceil(blurSigma * 3);
      const padRight = Math.max(0, offsetX) + spreadPx + Math.ceil(blurSigma * 3);
      const padBottom = Math.max(0, offsetY) + spreadPx + Math.ceil(blurSigma * 3);
      const totalW = w + padLeft + padRight;
      const totalH = h + padTop + padBottom;

      // 步骤 1：把原图层 alpha 放到大画布中央（单通道）
      // 先创建全透明的大画布 alpha（全 0）
      const bigAlphaRGBA = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).png().toBuffer();

      const layerOnBig = await sharp(bigAlphaRGBA)
        .composite([{ input: buffer, left: padLeft, top: padTop }])
        .png()
        .toBuffer();

      const bigAlpha = await sharp(layerOnBig).extractChannel('alpha').png().toBuffer();

      // 步骤 2：膨胀 spread（在大画布上膨胀，才有空间向外扩）
      let shadowMask: Buffer;
      if (spreadPx > 0) {
        // dilateAlpha 返回 RGBA 遮罩
        const dilatedRGBA = await this.dilateAlpha(bigAlpha, totalW, totalH, spreadPx);
        shadowMask = dilatedRGBA;
      } else {
        shadowMask = await this.alphaToMask(bigAlpha, totalW, totalH);
      }

      // 步骤 3：填充投影颜色
      const shadowColor = this.parseColorToRgba(shadow.color, shadow.opacity);
      let shadowShape = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: shadowColor },
      })
        .composite([{ input: shadowMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // 步骤 4：高斯模糊
      if (blurSigma > 0) {
        shadowShape = await sharp(shadowShape)
          .blur(blurSigma)
          .png()
          .toBuffer();
      }

      // 步骤 5：偏移投影（通过裁剪来移动）
      // 投影向右下偏移 offsetX/offsetY，相当于图像内容向右下移动
      // 我们需要从 shadowShape 中裁剪出偏移后的区域，放到正确位置
      // 更简单的方法：再创建一个大画布，把投影放到偏移位置
      const shadowX = offsetX;
      const shadowY = offsetY;
      const shadowOnCanvas = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: shadowShape, left: shadowX, top: shadowY }])
        .png()
        .toBuffer();

      // 步骤 6：把原图层放在大画布中央（在投影上面）
      const result = await sharp(shadowOnCanvas)
        .composite([{ input: buffer, left: padLeft, top: padTop }])
        .png()
        .toBuffer();

      // 返回结果和偏移信息
      return {
        buffer: result,
        offsetX: -padLeft,
        offsetY: -padTop,
        width: totalW,
        height: totalH,
      };
    } catch (e) {
      debugLog('投影失败:', e.message);
      return { buffer, offsetX: 0, offsetY: 0, width: layerW, height: layerH };
    }
  }

  /**
   * 应用内阴影
   * 原理：和投影类似，但阴影是在图层内部
   * 1. 反转 alpha（阴影在内容边缘内部）
   * 2. 偏移 + 模糊
   * 3. 用图层 alpha 做遮罩（只显示内容内部的阴影）
   */
  private async applyInnerShadow(
    buffer: Buffer,
    shadow: {
      color: string;
      blendMode: string;
      opacity: number;
      angle: number;
      distance: number;
      size: number;
      choke: number;
    },
    layerW: number,
    layerH: number,
  ): Promise<Buffer> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || layerW;
      const h = meta.height || layerH;
      if (!w || !h) return buffer;

      // 计算偏移（和投影相反，内阴影的偏移方向是反向的）
      const angleRad = (90 - shadow.angle) * Math.PI / 180;
      const offsetX = -Math.round(Math.cos(angleRad) * shadow.distance);
      const offsetY = Math.round(Math.sin(angleRad) * shadow.distance);

      const blurSigma = shadow.size > 0 ? Math.max(0.1, shadow.size / 2) : 0;

      // 提取 alpha，转成 RGBA 遮罩
      const alphaBuffer = await sharp(buffer).extractChannel('alpha').png().toBuffer();
      const alphaMask = await this.alphaToMask(alphaBuffer, w, h);

      // 生成阴影颜色图（带 alpha 遮罩）
      const shadowColor = this.parseColorToRgba(shadow.color, shadow.opacity);
      let shadowShape = await sharp({
        create: { width: w, height: h, channels: 4, background: shadowColor },
      })
        .composite([{ input: alphaMask, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // 模糊
      if (blurSigma > 0) {
        shadowShape = await sharp(shadowShape).blur(blurSigma).png().toBuffer();
      }

      // 偏移（内阴影是把阴影图向反方向偏移，然后用图层 alpha 做遮罩，只保留内部部分）
      const padX = Math.abs(offsetX) + Math.ceil(blurSigma * 3);
      const padY = Math.abs(offsetY) + Math.ceil(blurSigma * 3);
      const totalW = w + padX * 2;
      const totalH = h + padY * 2;

      // 大画布放偏移后的阴影
      let shadowOnCanvas = await sharp({
        create: {
          width: totalW,
          height: totalH,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();

      shadowOnCanvas = await sharp(shadowOnCanvas)
        .composite([{
          input: shadowShape,
          left: padX + offsetX,
          top: padY + offsetY,
        }])
        .png()
        .toBuffer();

      // 裁剪回原尺寸（中心部分 = 原图层区域）
      const croppedShadow = await sharp(shadowOnCanvas)
        .extract({ left: padX, top: padY, width: w, height: h })
        .png()
        .toBuffer();

      // 用图层 alpha 做遮罩（只保留图层内部的阴影）
      // 用 dest-in：阴影 * 图层 alpha = 只有图层内部有阴影
      const innerShadow = await sharp(croppedShadow)
        .composite([{ input: buffer, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // 混合模式
      const blend = this.getSharpBlendMode(shadow.blendMode);

      // 把内阴影混合到图层上
      return sharp(buffer)
        .composite([{ input: innerShadow, blend }])
        .png()
        .toBuffer();
    } catch (e) {
      debugLog('内阴影失败:', e.message);
      return buffer;
    }
  }

  /**
   * 应用描边
   * 原理：根据描边位置（outside/inside/center），用 alpha 通道扩张/收缩生成描边形状，填色
   */
  private async applyStroke(
    buffer: Buffer,
    stroke: {
      color: string;
      blendMode: string;
      opacity: number;
      size: number;
      position: 'inside' | 'center' | 'outside';
      fillType: 'color' | 'gradient' | 'pattern';
    },
    layerW: number,
    layerH: number,
  ): Promise<{ buffer: Buffer; expanded: boolean; offsetX: number; offsetY: number; width: number; height: number }> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || layerW;
      const h = meta.height || layerH;
      if (!w || !h || stroke.size <= 0) {
        return { buffer, expanded: false, offsetX: 0, offsetY: 0, width: w, height: h };
      }

      // 只处理纯色描边，渐变和图案后面再说
      if (stroke.fillType !== 'color') {
        return { buffer, expanded: false, offsetX: 0, offsetY: 0, width: w, height: h };
      }

      // 提取 alpha 通道
      const alphaBuffer = await sharp(buffer).extractChannel('alpha').png().toBuffer();

      // 生成描边颜色
      const strokeColor = this.parseColorToRgba(stroke.color, stroke.opacity);

      let strokeShape: Buffer;
      let expanded = false;
      let offsetX = 0;
      let offsetY = 0;
      let resultW = w;
      let resultH = h;
      let finalBuffer: Buffer;

      if (stroke.position === 'outside') {
        // 外描边：需要扩展画布
        const pad = Math.ceil(stroke.size);
        resultW = w + pad * 2;
        resultH = h + pad * 2;
        offsetX = -pad;
        offsetY = -pad;
        expanded = true;

        // 在扩展画布上重新合成原图
        const expandedBuffer = await sharp({
          create: { width: resultW, height: resultH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).png().toBuffer();

        const expandedWithLayer = await sharp(expandedBuffer)
          .composite([{ input: buffer, left: pad, top: pad }])
          .png()
          .toBuffer();

        // 在扩展画布上生成描边
        const expandedAlpha = await sharp(expandedWithLayer).extractChannel('alpha').png().toBuffer();
        const dilated = await this.dilateAlpha(expandedAlpha, resultW, resultH, stroke.size);
        strokeShape = await this.subtractAlpha(dilated, expandedAlpha, resultW, resultH, strokeColor);

        // 描边 + 原图
        const blend = this.getSharpBlendMode(stroke.blendMode);
        finalBuffer = await sharp(expandedWithLayer)
          .composite([{ input: strokeShape, blend }])
          .png()
          .toBuffer();
      } else if (stroke.position === 'inside') {
        // 内描边：不扩展画布
        const eroded = await this.erodeAlpha(alphaBuffer, w, h, stroke.size);
        strokeShape = await this.subtractAlphaFromOriginal(alphaBuffer, eroded, w, h, strokeColor);

        const blend = this.getSharpBlendMode(stroke.blendMode);
        finalBuffer = await sharp(buffer)
          .composite([{ input: strokeShape, blend }])
          .png()
          .toBuffer();
      } else {
        // 居中描边：向外扩展一半
        const halfSize = Math.max(1, Math.floor(stroke.size / 2));
        const pad = halfSize;
        resultW = w + pad * 2;
        resultH = h + pad * 2;
        offsetX = -pad;
        offsetY = -pad;
        expanded = true;

        const expandedBuffer = await sharp({
          create: { width: resultW, height: resultH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).png().toBuffer();

        const expandedWithLayer = await sharp(expandedBuffer)
          .composite([{ input: buffer, left: pad, top: pad }])
          .png()
          .toBuffer();

        const expandedAlpha = await sharp(expandedWithLayer).extractChannel('alpha').png().toBuffer();
        const dilated = await this.dilateAlpha(expandedAlpha, resultW, resultH, halfSize);
        const eroded = await this.erodeAlpha(expandedAlpha, resultW, resultH, halfSize);
        strokeShape = await this.subtractAlpha(dilated, eroded, resultW, resultH, strokeColor);

        const blend = this.getSharpBlendMode(stroke.blendMode);
        finalBuffer = await sharp(expandedWithLayer)
          .composite([{ input: strokeShape, blend }])
          .png()
          .toBuffer();
      }

      return { buffer: finalBuffer, expanded, offsetX, offsetY, width: resultW, height: resultH };
    } catch (e) {
      debugLog('描边失败:', e.message);
      return { buffer, expanded: false, offsetX: 0, offsetY: 0, width: layerW, height: layerH };
    }
  }

  /**
   * 应用外发光
   */
  private async applyOuterGlow(
    buffer: Buffer,
    glow: {
      color: string;
      blendMode: string;
      opacity: number;
      size: number;
      spread: number;
    },
    layerW: number,
    layerH: number,
  ): Promise<{ buffer: Buffer; offsetX: number; offsetY: number; width: number; height: number }> {
    // 外发光 ≈ 0 角度、0 距离的投影（均匀向外）
    return this.applyDropShadow(
      buffer,
      {
        ...glow,
        angle: 0,
        distance: 0,
      },
      layerW,
      layerH,
    );
  }

  /**
   * 应用内发光
   */
  private async applyInnerGlow(
    buffer: Buffer,
    glow: {
      color: string;
      blendMode: string;
      opacity: number;
      size: number;
      choke: number;
      source: 'edge' | 'center';
    },
    layerW: number,
    layerH: number,
  ): Promise<Buffer> {
    // 内发光 ≈ 0 角度、0 距离的内阴影
    return this.applyInnerShadow(
      buffer,
      {
        ...glow,
        angle: 0,
        distance: 0,
      },
      layerW,
      layerH,
    );
  }

  // ===================== 工具函数 =====================

  /**
   * 解析颜色字符串为 {r,g,b,alpha} 对象
   * 支持 rgb(r,g,b) / rgba(r,g,b,a) / #rrggbb
   */
  private parseColorToRgba(colorStr: string, opacity = 1): { r: number; g: number; b: number; alpha: number } {
    // 默认黑色
    let r = 0, g = 0, b = 0, a = 1;

    // rgb/rgba 格式
    const rgbaMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (rgbaMatch) {
      r = parseInt(rgbaMatch[1]);
      g = parseInt(rgbaMatch[2]);
      b = parseInt(rgbaMatch[3]);
      if (rgbaMatch[4] != null) {
        a = parseFloat(rgbaMatch[4]);
      }
    } else if (colorStr.startsWith('#')) {
      // #rrggbb 格式
      const hex = colorStr.slice(1);
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      }
    }

    return {
      r: Math.max(0, Math.min(255, r)),
      g: Math.max(0, Math.min(255, g)),
      b: Math.max(0, Math.min(255, b)),
      alpha: Math.max(0, Math.min(1, a * opacity)),
    };
  }

  /**
   * alpha 通道形态学膨胀（向外扩张 size 像素）
   * 使用精确的二值形态学膨胀算法（直接操作像素）
   * 返回 RGBA 图（白色填充 + alpha 通道 = 膨胀后的遮罩值）
   */
  private async dilateAlpha(alphaBuffer: Buffer, w: number, h: number, size: number): Promise<Buffer> {
    if (size <= 0) {
      return this.alphaToMask(alphaBuffer, w, h);
    }

    // 读取单通道 alpha 的 raw 数据
    const { data: srcData, info } = await sharp(alphaBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const srcW = info.width;
    const srcH = info.height;

    // 二值形态学膨胀（方形结构元素，和 PS 描边效果更一致）
    const radius = Math.round(size);
    const outData = Buffer.alloc(srcW * srcH);

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        // 检查 (x,y) 周围 radius 范围内是否有非透明像素
        // 方形结构元素：|dx| <= radius && |dy| <= radius
        let dilated = 0;
        const yStart = Math.max(0, y - radius);
        const yEnd = Math.min(srcH - 1, y + radius);
        const xStart = Math.max(0, x - radius);
        const xEnd = Math.min(srcW - 1, x + radius);

        for (let yy = yStart; yy <= yEnd && dilated === 0; yy++) {
          for (let xx = xStart; xx <= xEnd && dilated === 0; xx++) {
            if (srcData[yy * srcW + xx] > 128) {
              dilated = 255;
            }
          }
        }

        outData[y * srcW + x] = dilated;
      }
    }

    // 把结果转回单通道 PNG，再转成 RGBA 遮罩
    const outPNG = await sharp(outData, {
      raw: { width: srcW, height: srcH, channels: 1 },
    }).png().toBuffer();

    return this.alphaToMask(outPNG, srcW, srcH);
  }

  /**
   * alpha 通道形态学收缩（向内侵蚀 size 像素）
   * 使用精确的二值形态学侵蚀算法（直接操作像素）
   * 返回 RGBA 图（白色填充 + alpha 通道 = 收缩后的遮罩值）
   */
  private async erodeAlpha(alphaBuffer: Buffer, w: number, h: number, size: number): Promise<Buffer> {
    if (size <= 0) {
      return this.alphaToMask(alphaBuffer, w, h);
    }

    // 读取单通道 alpha 的 raw 数据
    const { data: srcData, info } = await sharp(alphaBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const srcW = info.width;
    const srcH = info.height;

    // 二值形态学侵蚀（方形结构元素，和 PS 描边效果更一致）
    // 只有当结构元素范围内全都是不透明像素时，输出才是不透明
    // 边界外的像素视为透明（0），所以靠近边界的不透明区域会被侵蚀掉
    const radius = Math.round(size);
    const outData = Buffer.alloc(srcW * srcH);

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        let eroded = 255; // 假设全不透明
        const yStart = y - radius;
        const yEnd = y + radius;
        const xStart = x - radius;
        const xEnd = x + radius;

        for (let yy = yStart; yy <= yEnd && eroded === 255; yy++) {
          for (let xx = xStart; xx <= xEnd && eroded === 255; xx++) {
            // 边界外的像素视为透明
            if (xx < 0 || xx >= srcW || yy < 0 || yy >= srcH || srcData[yy * srcW + xx] < 128) {
              eroded = 0;
            }
          }
        }

        outData[y * srcW + x] = eroded;
      }
    }

    // 把结果转回单通道 PNG，再转成 RGBA 遮罩
    const outPNG = await sharp(outData, {
      raw: { width: srcW, height: srcH, channels: 1 },
    }).png().toBuffer();

    return this.alphaToMask(outPNG, srcW, srcH);
  }

  /**
   * 把单通道 alpha 图转成 RGBA 遮罩图（白色填充 + alpha 通道 = 遮罩值）
   * 注意：不能用 dest-in + 单通道图的方式，因为单通道图做 blend 源时 alpha=255，遮罩完全失效
   * 正确做法：创建 RGB 底图 + joinChannel(alpha)
   */
  private async alphaToMask(alphaBuffer: Buffer, w: number, h: number): Promise<Buffer> {
    // 创建 RGB 白色底图（3通道），然后把单通道 alpha join 成第 4 通道
    const whiteRGB = await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();

    return sharp(whiteRGB)
      .joinChannel(alphaBuffer)
      .png()
      .toBuffer();
  }

  /**
   * 用 alpha A - alpha B = 只有 A 有 B 没有的区域，填成指定颜色
   * alphaA 和 alphaB 可以是单通道或 RGBA
   */
  private async subtractAlpha(
    alphaA: Buffer,
    alphaB: Buffer,
    w: number,
    h: number,
    color: { r: number; g: number; b: number; alpha: number },
  ): Promise<Buffer> {
    // 确保两个遮罩都是 RGBA 格式（带正确的 alpha 通道）
    const maskA = await this.ensureMask(alphaA, w, h);
    const maskB = await this.ensureMask(alphaB, w, h);

    // 用颜色填充 A 的区域
    const colorA = await sharp({
      create: { width: w, height: h, channels: 4, background: color },
    })
      .composite([{ input: maskA, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // dest-out：去掉 B 的区域
    return sharp(colorA)
      .composite([{ input: maskB, blend: 'dest-out' }])
      .png()
      .toBuffer();
  }

  /**
   * 确保遮罩是 RGBA 格式（有正确 alpha 通道）
   */
  private async ensureMask(maybeAlpha: Buffer, w: number, h: number): Promise<Buffer> {
    const meta = await sharp(maybeAlpha).metadata();
    if (meta.channels === 4) {
      // 已经是 RGBA，直接用
      return maybeAlpha;
    }
    // 单通道，转成 RGBA 遮罩（白色填充 + alpha = 灰度值）
    return this.alphaToMask(maybeAlpha, w, h);
  }

  /**
   * 用原始 alpha - 收缩后的 alpha（内部边缘描边）
   */
  private async subtractAlphaFromOriginal(
    originalAlpha: Buffer,
    erodedAlpha: Buffer,
    w: number,
    h: number,
    color: { r: number; g: number; b: number; alpha: number },
  ): Promise<Buffer> {
    // 原始 - 收缩 = 边缘环
    return this.subtractAlpha(originalAlpha, erodedAlpha, w, h, color);
  }
}
