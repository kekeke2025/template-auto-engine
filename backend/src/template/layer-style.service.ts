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

    // 7. 渐变叠加
    if (style.gradientOverlay && style.gradientOverlay.length > 0) {
      for (const overlay of style.gradientOverlay) {
        if (overlay.enabled) {
          result = await this.applyGradientOverlay(result, overlay);
        }
      }
    }

    // 8-10. 图案叠加、光泽、斜面浮雕（后续实现）

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
   * 应用渐变叠加
   * 原理：用 SVG 生成线性渐变图，然后按 blendMode 混合到图层上（受图层 alpha 遮罩）
   */
  private async applyGradientOverlay(
    buffer: Buffer,
    gradient: {
      blendMode: string;
      opacity: number;
      angle: number;
      scale: number;
      style: string; // 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
      gradientType: string; // 'solid' | 'noise'
      colorStops: Array<{ color: string; location: number; opacity: number }>;
    },
  ): Promise<Buffer> {
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || 0;
      const h = meta.height || 0;
      if (!w || !h) return buffer;

      // PS 渐变角度：0° 从左到右（水平），顺时针旋转
      // 转换为方向向量（屏幕坐标，Y 轴向下）
      const angleRad = (gradient.angle * Math.PI) / 180;
      const dx = Math.cos(angleRad);
      const dy = Math.sin(angleRad);

      // 计算图层在渐变方向上的投影长度（渐变线的基础长度）
      // 矩形在方向 (dx,dy) 上的投影长度 = w * |dx| + h * |dy|
      // scale=1 时渐变恰好从图层一端过渡到另一端
      const gradientLength = Math.abs(dx) * w + Math.abs(dy) * h;
      const halfLen = gradientLength / 2;
      const cx = w / 2;
      const cy = h / 2;

      // 计算渐变线的两个端点（穿过中心，沿渐变方向）
      const x1 = cx - dx * halfLen;
      const y1 = cy - dy * halfLen;
      const x2 = cx + dx * halfLen;
      const y2 = cy + dy * halfLen;

      // 处理 scale（渐变缩放，PS 里是百分比，ag-psd 返回的是比例值，1 = 100%）
      // scale < 1 时渐变范围变小，两端用起止色填充
      const scale = gradient.scale != null ? gradient.scale : 1;
      let stops = [...gradient.colorStops].sort((a, b) => a.location - b.location);

      if (scale !== 1 && scale > 0) {
        // 缩放后的渐变在中间，两边用起止色填充
        // 将所有 stop 映射到 [ (1-scale)/2, (1+scale)/2 ] 范围内
        const offset = (1 - scale) / 2;
        stops = stops.map(s => ({
          ...s,
          location: offset + s.location * scale,
        }));
        // 两端加上起止色的 stop，保证边缘是纯色
        if (stops.length > 0) {
          stops.unshift({ ...stops[0], location: 0 });
          stops.push({ ...stops[stops.length - 1], location: 1 });
        }
      }

      // 生成 SVG 渐变
      const stopsSVG = stops
        .map(s => {
          const rgb = this.parseColorToRgba(s.color, s.opacity * gradient.opacity);
          const offsetPct = (s.location * 100).toFixed(2);
          const stopOpacity = rgb.alpha;
          return `    <stop offset="${offsetPct}%" stop-color="rgb(${rgb.r},${rgb.g},${rgb.b})" stop-opacity="${stopOpacity}" />`;
        })
        .join('\n');

      const svg = `
        <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">
${stopsSVG}
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grad)" />
        </svg>
      `;

      // SVG → PNG
      const gradientPNG = await sharp(Buffer.from(svg)).png().toBuffer();

      // 用图层 alpha 做遮罩（渐变只在图层不透明区域可见）
      const maskedGradient = await sharp(gradientPNG)
        .composite([{ input: buffer, blend: 'dest-in' }])
        .png()
        .toBuffer();

      // 混合到图层上
      const blend = this.getSharpBlendMode(gradient.blendMode);
      return sharp(buffer)
        .composite([{ input: maskedGradient, blend }])
        .png()
        .toBuffer();
    } catch (e) {
      debugLog('渐变叠加失败:', e.message);
      return buffer;
    }
  }

  /**
   * 应用投影
   * 原理：
   * 1. 提取图层 alpha 通道作为影子形状
   * 2. 先膨胀 spread（实边部分）
   * 3. 对 alpha 做高斯模糊（只模糊透明度，颜色不被稀释）
   * 4. 用模糊后的 alpha 填充影子颜色
   * 5. 按角度和距离偏移
   * 6. 放到图层下面，按 blendMode 混合
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

      // 计算偏移量（PS 角度：0° 向上为正，顺时针转，表示阴影偏移方向）
      // 屏幕坐标系：0°→上(负Y), 90°→右(正X), 180°→下(正Y), 270°→左(负X)
      const angleRad = (90 - shadow.angle) * Math.PI / 180;
      const offsetX = Math.round(Math.cos(angleRad) * shadow.distance);
      const offsetY = -Math.round(Math.sin(angleRad) * shadow.distance);

      // spread 百分比 → 像素
      const spreadAmount = (shadow.spread || 0) / 100;
      const spreadPx = spreadAmount > 0 && shadow.size > 0
        ? Math.max(1, Math.round(shadow.size * spreadAmount))
        : 0;

      // 模糊半径：PS 的 size ≈ 2 * sigma * 3（高斯模糊 3sigma 外几乎为0）
      // 经测算：sigma ≈ size / 6 时和 PS 效果最接近
      // blurSize 是 size 减去 spread 后的模糊部分
      const blurSize = shadow.size * (1 - spreadAmount);
      const blurSigma = blurSize > 0 ? Math.max(0.1, blurSize / 3.5) : 0;

      // 计算大画布尺寸（给膨胀、模糊、偏移留出空间）
      const padLeft = Math.max(0, -offsetX) + spreadPx + Math.ceil(blurSigma * 4);
      const padTop = Math.max(0, -offsetY) + spreadPx + Math.ceil(blurSigma * 4);
      const padRight = Math.max(0, offsetX) + spreadPx + Math.ceil(blurSigma * 4);
      const padBottom = Math.max(0, offsetY) + spreadPx + Math.ceil(blurSigma * 4);
      const totalW = w + padLeft + padRight;
      const totalH = h + padTop + padBottom;

      // 步骤 1：把原图层 alpha 放到大画布中央（单通道）
      const bigAlphaRGBA = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).png().toBuffer();

      const layerOnBig = await sharp(bigAlphaRGBA)
        .composite([{ input: buffer, left: padLeft, top: padTop }])
        .png()
        .toBuffer();

      // 提取 alpha 通道（单通道灰度图）
      let alphaMask = await sharp(layerOnBig).extractChannel('alpha').png().toBuffer();

      // 步骤 2：膨胀 spread（实边扩展）
      if (spreadPx > 0) {
        const dilated = await this.dilateAlpha(alphaMask, totalW, totalH, spreadPx);
        // 膨胀后是 RGBA，重新提取 alpha
        alphaMask = await sharp(dilated).extractChannel('alpha').png().toBuffer();
      }

      // 步骤 3：对 alpha 做高斯模糊（只模糊透明度遮罩，颜色后面再填）
      if (blurSigma > 0) {
        alphaMask = await sharp(alphaMask)
          .blur(blurSigma)
          .png()
          .toBuffer();
      }

      // 步骤 4：用模糊后的 alpha 遮罩填充投影颜色
      // 注意：单通道 PNG 不能直接做 dest-in 源（sharp 会解码成 3 通道 sRGB，alpha=255）
      // 必须先用 alphaToMask 转成 RGBA 白色遮罩，渐变才会生效
      const shadowMask = await this.alphaToMask(alphaMask, totalW, totalH);
      const shadowColor = this.parseColorToRgba(shadow.color, shadow.opacity);
      let shadowShape = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: shadowColor },
      })
        .composite([{
          input: shadowMask,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();

      // 步骤 5：偏移投影（放到正确位置）
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
   * 2. 偏移 + 模糊（先模糊 alpha 再填色）
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

      // 计算偏移（内阴影的偏移方向和投影相反，因为阴影在内部）
      // 光源从 angle 方向照来，内阴影出现在光源对侧的内部边缘
      const angleRad = (90 - shadow.angle) * Math.PI / 180;
      const offsetX = Math.round(Math.cos(angleRad) * shadow.distance);
      const offsetY = -Math.round(Math.sin(angleRad) * shadow.distance);

      const blurSigma = shadow.size > 0 ? Math.max(0.1, shadow.size / 3.5) : 0;

      // choke 收缩百分比 → 像素
      const chokeAmount = (shadow.choke || 0) / 100;
      const chokePx = chokeAmount > 0 && shadow.size > 0
        ? Math.max(1, Math.round(shadow.size * chokeAmount))
        : 0;

      // 提取 alpha 通道
      const alphaBuffer = await sharp(buffer).extractChannel('alpha').png().toBuffer();

      // 先做 choke（向内收缩 alpha，相当于内阴影的 spread）
      let shadowAlpha = alphaBuffer;
      if (chokePx > 0) {
        // erodeAlpha 是向内侵蚀，返回 RGBA
        const eroded = await this.erodeAlpha(alphaBuffer, w, h, chokePx);
        shadowAlpha = await sharp(eroded).extractChannel('alpha').png().toBuffer();
      }

      // 对 alpha 做模糊（先模糊透明度遮罩）
      if (blurSigma > 0) {
        shadowAlpha = await sharp(shadowAlpha)
          .blur(blurSigma)
          .png()
          .toBuffer();
      }

      // 偏移阴影（向 offset 方向移动，然后用原 alpha 做遮罩取内部部分）
      const padX = Math.abs(offsetX) + Math.ceil(blurSigma * 4);
      const padY = Math.abs(offsetY) + Math.ceil(blurSigma * 4);
      const totalW = w + padX * 2;
      const totalH = h + padY * 2;

      // 大画布放偏移后的阴影 alpha
      let shadowOnCanvas = await sharp({
        create: {
          width: totalW,
          height: totalH,
          channels: 1,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      }).png().toBuffer();

      // 把阴影 alpha 放到偏移位置
      // 内阴影：偏移方向和光源方向相同（阴影出现在光源对侧）
      shadowOnCanvas = await sharp(shadowOnCanvas)
        .composite([{
          input: shadowAlpha,
          left: padX + offsetX,
          top: padY + offsetY,
        }])
        .png()
        .toBuffer();

      // 裁剪回原尺寸（中心部分 = 原图层区域）
      const croppedShadowAlpha = await sharp(shadowOnCanvas)
        .extract({ left: padX, top: padY, width: w, height: h })
        .png()
        .toBuffer();

      // 生成阴影颜色（用模糊后的 alpha 做遮罩填色）
      // 注意：单通道 PNG 不能直接做 dest-in 源，必须先用 alphaToMask 转成 RGBA 遮罩
      const innerShadowMask = await this.alphaToMask(croppedShadowAlpha, w, h);
      const shadowColor = this.parseColorToRgba(shadow.color, shadow.opacity);
      let innerShadowShape = await sharp({
        create: { width: w, height: h, channels: 4, background: shadowColor },
      })
        .composite([{
          input: innerShadowMask,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();

      // 用图层 alpha 做遮罩（只保留图层内部的阴影）
      // dest-in = 颜色 * 图层 alpha = 只有图层内部有阴影
      const innerShadow = await sharp(innerShadowShape)
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

      let expanded = false;
      let offsetX = 0;
      let offsetY = 0;
      let resultW = w;
      let resultH = h;
      let finalBuffer: Buffer;

      // 计算需要的画布扩展（外描边和居中描边需要）
      let pad = 0;
      if (stroke.position === 'outside') {
        pad = Math.ceil(stroke.size) + 2; // 多留 2px 抗锯齿
      } else if (stroke.position === 'center') {
        pad = Math.ceil(stroke.size / 2) + 2;
      }

      // 创建工作画布（如果需要扩展）
      let workBuffer = buffer;
      let workW = w;
      let workH = h;

      if (pad > 0) {
        resultW = w + pad * 2;
        resultH = h + pad * 2;
        offsetX = -pad;
        offsetY = -pad;
        expanded = true;
        workW = resultW;
        workH = resultH;

        const expandedBuffer = await sharp({
          create: { width: resultW, height: resultH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).png().toBuffer();

        workBuffer = await sharp(expandedBuffer)
          .composite([{ input: buffer, left: pad, top: pad }])
          .png()
          .toBuffer();
      }

      // 提取 alpha 通道
      const alphaBuffer = await sharp(workBuffer).extractChannel('alpha').png().toBuffer();

      // 用圆形结构元素膨胀 + 4x 超采样生成描边（平滑抗锯齿，接近 PS 矢量描边质量）
      const strokePNG = await this.generateStrokeSSAA(
        alphaBuffer, workW, workH,
        stroke.size,
        stroke.position as 'outside' | 'inside' | 'center',
        strokeColor,
        4, // 4x 超采样
      );

      // 混合
      const blend = this.getSharpBlendMode(stroke.blendMode);
      finalBuffer = await sharp(workBuffer)
        .composite([{ input: strokePNG, blend }])
        .png()
        .toBuffer();

      return { buffer: finalBuffer, expanded, offsetX, offsetY, width: resultW, height: resultH };
    } catch (e) {
      debugLog('描边失败:', e.message);
      return { buffer, expanded: false, offsetX: 0, offsetY: 0, width: layerW, height: layerH };
    }
  }

  /**
   * 用圆形膨胀 + 超采样生成高质量描边
   * @param alphaBuffer 原始 alpha 通道 PNG
   * @param w 宽
   * @param h 高
   * @param strokeSize 描边宽度（像素）
   * @param position 位置
   * @param strokeColor 颜色
   * @param scale 超采样倍率（2 = 2x, 4 = 4x）
   */
  private async generateStrokeSSAA(
    alphaBuffer: Buffer,
    w: number,
    h: number,
    strokeSize: number,
    position: 'outside' | 'inside' | 'center',
    strokeColor: { r: number; g: number; b: number; a: number },
    scale: number = 4,
  ): Promise<Buffer> {
    const sw = w * scale;
    const sh = h * scale;

    // 放大 alpha（nearest 保持硬边，然后在高分辨率下膨胀）
    const alphaScaled = await sharp(alphaBuffer)
      .resize(sw, sh, { kernel: 'nearest' })
      .toColorspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const src = alphaScaled.data;
    const sizePx = strokeSize * scale;

    // 根据位置计算膨胀/收缩量
    let dilateSize = 0;
    let erodeSize = 0;

    if (position === 'outside') {
      dilateSize = sizePx;
      erodeSize = 0;
    } else if (position === 'inside') {
      dilateSize = 0;
      erodeSize = sizePx;
    } else {
      // center：内半部分 + 外半部分
      dilateSize = sizePx / 2;
      erodeSize = sizePx / 2;
    }

    // 圆形结构元素膨胀
    let alphaDilated: Uint8Array;
    if (dilateSize > 0) {
      alphaDilated = this.dilateCircleRaw(src, sw, sh, dilateSize);
    } else {
      alphaDilated = new Uint8Array(src);
    }

    // 圆形结构元素侵蚀（如果需要内描边或居中描边的内侧）
    let alphaResult: Uint8Array;
    if (erodeSize > 0) {
      alphaResult = this.erodeCircleRaw(alphaDilated, sw, sh, erodeSize);
    } else {
      alphaResult = alphaDilated;
    }

    // 描边 = 膨胀后形状 - 原始形状（外描边）
    // 或 = 原始形状 - 侵蚀后形状（内描边）
    const strokeAlpha = new Uint8Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      const resultA = alphaResult[i];
      const origA = src[i];
      let strokeA: number;

      if (position === 'outside') {
        strokeA = Math.max(0, resultA - origA);
      } else if (position === 'inside') {
        strokeA = Math.max(0, origA - resultA);
      } else {
        // center：膨胀 - 侵蚀
        strokeA = Math.max(0, resultA - alphaDilated[i] > 0 ? 0 : 0); // 占位，下面重新算
      }
      strokeAlpha[i] = strokeA;
    }

    // center 描边重新计算：膨胀（向外）和侵蚀（向内）之间的区域
    if (position === 'center') {
      const dilated = this.dilateCircleRaw(src, sw, sh, sizePx / 2);
      const eroded = this.erodeCircleRaw(src, sw, sh, sizePx / 2);
      for (let i = 0; i < sw * sh; i++) {
        strokeAlpha[i] = Math.max(0, dilated[i] - eroded[i]);
      }
    }

    // 转成 RGBA 颜色
    const strokeRGBA = Buffer.alloc(sw * sh * 4);
    for (let i = 0; i < sw * sh; i++) {
      const idx = i * 4;
      strokeRGBA[idx] = strokeColor.r;
      strokeRGBA[idx + 1] = strokeColor.g;
      strokeRGBA[idx + 2] = strokeColor.b;
      strokeRGBA[idx + 3] = Math.round(strokeAlpha[i] * strokeColor.a);
    }

    // 缩小回原分辨率（lanczos3 高质量抗锯齿）
    return sharp(strokeRGBA, { raw: { width: sw, height: sh, channels: 4 } })
      .resize(w, h, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
  }

  /**
   * 圆形结构元素灰度膨胀（直接操作 raw 单通道数据）
   */
  private dilateCircleRaw(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
    const r = Math.round(radius);
    const r2 = r * r;
    const out = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let max = 0;
        const yStart = Math.max(0, y - r);
        const yEnd = Math.min(h - 1, y + r);

        for (let yy = yStart; yy <= yEnd; yy++) {
          const dy = yy - y;
          const dxMax = Math.floor(Math.sqrt(r2 - dy * dy));
          const xStart = Math.max(0, x - dxMax);
          const xEnd = Math.min(w - 1, x + dxMax);

          for (let xx = xStart; xx <= xEnd; xx++) {
            const v = src[yy * w + xx];
            if (v > max) max = v;
          }
        }

        out[y * w + x] = max;
      }
    }

    return out;
  }

  /**
   * 圆形结构元素灰度侵蚀（直接操作 raw 单通道数据）
   */
  private erodeCircleRaw(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
    const r = Math.round(radius);
    const r2 = r * r;
    const out = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let min = 255;
        const yStart = y - r;
        const yEnd = y + r;

        for (let yy = yStart; yy <= yEnd; yy++) {
          const dy = yy - y;
          const dxMax = Math.floor(Math.sqrt(r2 - dy * dy));
          const xStart = x - dxMax;
          const xEnd = x + dxMax;

          for (let xx = xStart; xx <= xEnd; xx++) {
            if (xx < 0 || xx >= w || yy < 0 || yy >= h) {
              min = 0;
              break;
            }
            const v = src[yy * w + xx];
            if (v < min) min = v;
          }
          if (min === 0) break;
        }

        out[y * w + x] = min;
      }
    }

    return out;
  }

  /**
   * 计算 alpha 图的有符号距离场（SDF）
   * 正值表示在形状外（到边缘的距离），负值表示在形状内
   * 使用 Saito-Tawaki 行扫描 + 平方距离的欧氏距离变换，精确欧氏距离
   */
  private async computeDistanceField(
    alphaBuffer: Buffer,
    w: number,
    h: number,
  ): Promise<Float32Array> {
    // 读取单通道 alpha
    const { data: srcData } = await sharp(alphaBuffer)
      .toColorspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 二值化阈值
    const threshold = 128;

    // 计算外部距离场（形状外的像素到边缘的距离）
    const distOuter = this.euclideanDistanceTransform(srcData, w, h, threshold, false);
    // 计算内部距离场（形状内的像素到边缘的距离）
    const distInner = this.euclideanDistanceTransform(srcData, w, h, threshold, true);

    // 合并成有符号距离场：外部为正，内部为负
    const sdf = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      // 边缘像素（alpha 在阈值附近）距离为 0
      const alpha = srcData[i];
      if (alpha >= threshold) {
        sdf[i] = -distInner[i]; // 内部：负距离
      } else {
        sdf[i] = distOuter[i]; // 外部：正距离
      }
    }

    return sdf;
  }

  /**
   * 欧氏距离变换（Saito-Tawaki 算法的简化版，行+列独立扫描）
   * @param src 源数据（单通道 alpha）
   * @param w 宽
   * @param h 高
   * @param threshold 二值化阈值
   * @param invert true=计算内部距离(背景是形状内), false=计算外部距离(背景是形状外)
   * @returns 距离场（每个像素到最近前景像素的欧氏距离）
   */
  private euclideanDistanceTransform(
    src: Uint8Array,
    w: number,
    h: number,
    threshold: number,
    invert: boolean,
  ): Float32Array {
    const INF = 1e10;
    // f[y][x] = 距离平方（先算平方距离，最后开方）
    const f = new Float32Array(w * h);

    // 初始化：前景像素距离=0，背景=INF
    for (let i = 0; i < w * h; i++) {
      const isForeground = invert ? (src[i] < threshold) : (src[i] >= threshold);
      f[i] = isForeground ? 0 : INF;
    }

    // 第一步：行方向（每一行内做 1D 距离变换）
    for (let y = 0; y < h; y++) {
      const row = y * w;
      // 从左到右
      for (let x = 1; x < w; x++) {
        f[row + x] = Math.min(f[row + x], f[row + x - 1] + 1);
      }
      // 从右到左
      for (let x = w - 2; x >= 0; x--) {
        f[row + x] = Math.min(f[row + x], f[row + x + 1] + 1);
      }
    }

    // 第二步：列方向（每一列内做 1D 距离变换，用平方距离）
    // 这是 Saito-Tawaki 的核心：每一列用抛物线下包络计算精确的行方向距离
    const colBuf = new Float32Array(h);
    const result = new Float32Array(w * h);

    for (let x = 0; x < w; x++) {
      // 收集这一列的行距离平方
      for (let y = 0; y < h; y++) {
        colBuf[y] = f[y * w + x];
      }

      // 1D 欧氏距离变换（列方向）
      // 用下包络算法计算每个 y 到最近"源"的距离
      const d = this.distanceTransform1D(colBuf, h);

      // 写回结果
      for (let y = 0; y < h; y++) {
        result[y * w + x] = Math.sqrt(d[y]);
      }
    }

    return result;
  }

  /**
   * 1D 欧氏距离变换（基于抛物线下包络）
   * 输入：每一点的"横向偏移平方"（已经是平方值）
   * 输出：每一点的最近源距离的平方
   */
  private distanceTransform1D(f: Float32Array, n: number): Float32Array {
    const d = new Float32Array(n);
    // 用简单的两遍扫描近似（对于图像描边，精度足够）
    // 实际上 1D 用两遍扫描 + 平方就能得到精确结果
    const v = new Int32Array(n); // 抛物线顶点索引
    const z = new Float32Array(n + 1); // 交点位置
    let k = 0; // 下包络中抛物线数量
    v[0] = 0;
    z[0] = -1e10;
    z[1] = 1e10;

    for (let q = 1; q < n; q++) {
      // 求 q 处抛物线与 k 处抛物线的交点
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = 1e10;
    }

    // 回溯计算距离
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }

    return d;
  }

  /**
   * 用距离场生成描边
   * @param sdf 有符号距离场（外正内负）
   * @param w 宽
   * @param h 高
   * @param strokeSize 描边宽度（像素）
   * @param position 'outside' | 'inside' | 'center'
   * @param strokeColor 描边颜色
   */
  private generateStrokeFromSDF(
    sdf: Float32Array,
    w: number,
    h: number,
    strokeSize: number,
    position: 'outside' | 'inside' | 'center',
    strokeColor: { r: number; g: number; b: number; a: number },
  ): Buffer {
    const out = Buffer.alloc(w * h * 4);

    // 描边的内外边界（有符号距离）
    // sdf < 0 是内部，sdf > 0 是外部
    let innerDist: number; // 描边内边缘的距离值
    let outerDist: number; // 描边外边缘的距离值

    if (position === 'outside') {
      // 外描边：从边缘(0)向外 strokeSize
      innerDist = 0;
      outerDist = strokeSize;
    } else if (position === 'inside') {
      // 内描边：从边缘(0)向内 strokeSize
      innerDist = -strokeSize;
      outerDist = 0;
    } else {
      // 居中描边：内 strokeSize/2，外 strokeSize/2
      innerDist = -strokeSize / 2;
      outerDist = strokeSize / 2;
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const d = sdf[idx];
        const outIdx = idx * 4;

        // 计算 alpha：距离在 [innerDist, outerDist] 范围内渐变
        // 用 1 像素宽的抗锯齿过渡
        let alpha = 0;

        if (d <= innerDist - 0.5) {
          // 完全在描边内部（形状更里面），没有描边
          alpha = 0;
        } else if (d >= outerDist + 0.5) {
          // 完全在描边外部，没有描边
          alpha = 0;
        } else if (d >= innerDist + 0.5 && d <= outerDist - 0.5) {
          // 在描边中间，完全不透明
          alpha = 1;
        } else if (d < innerDist + 0.5 && d > innerDist - 0.5) {
          // 内边缘抗锯齿
          alpha = (d - (innerDist - 0.5));
        } else if (d > outerDist - 0.5 && d < outerDist + 0.5) {
          // 外边缘抗锯齿
          alpha = (outerDist + 0.5 - d);
        }

        alpha = Math.max(0, Math.min(1, alpha));

        out[outIdx] = strokeColor.r;
        out[outIdx + 1] = strokeColor.g;
        out[outIdx + 2] = strokeColor.b;
        out[outIdx + 3] = Math.round(alpha * strokeColor.a * 255);
      }
    }

    return out;
  }

  /**
   * 应用外发光
   * 原理：
   * 1. 提取图层 alpha 通道
   * 2. 膨胀 spread（实边扩展）
   * 3. 对 alpha 做高斯模糊
   * 4. 用模糊后的 alpha 填充发光颜色
   * 5. 把发光图放在图层下面
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
    try {
      const meta = await sharp(buffer).metadata();
      const w = meta.width || layerW;
      const h = meta.height || layerH;
      if (!w || !h) return { buffer, offsetX: 0, offsetY: 0, width: w, height: h };

      // spread 百分比 → 像素
      const spreadAmount = (glow.spread || 0) / 100;
      const spreadPx = spreadAmount > 0 && glow.size > 0
        ? Math.max(1, Math.round(glow.size * spreadAmount))
        : 0;

      // 模糊半径：PS 中 size 是模糊范围（约 2 * sigma * 2.5）
      // sigma 越大，发光越散
      const blurSize = glow.size * (1 - spreadAmount);
      const blurSigma = blurSize > 0 ? Math.max(0.1, blurSize / 3) : 0;

      // 四周扩展的 padding
      const pad = spreadPx + Math.ceil(blurSigma * 3.5);
      const totalW = w + pad * 2;
      const totalH = h + pad * 2;

      // 步骤 1：把图层 alpha 放到大画布中央
      const bigCanvas = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).png().toBuffer();

      const layerOnBig = await sharp(bigCanvas)
        .composite([{ input: buffer, left: pad, top: pad }])
        .png()
        .toBuffer();

      // 提取 alpha 通道
      let alphaMask = await sharp(layerOnBig).extractChannel('alpha').png().toBuffer();

      // 步骤 2：膨胀 spread
      if (spreadPx > 0) {
        const dilated = await this.dilateAlpha(alphaMask, totalW, totalH, spreadPx);
        alphaMask = await sharp(dilated).extractChannel('alpha').png().toBuffer();
      }

      // 步骤 3：对 alpha 做高斯模糊（只模糊透明度）
      if (blurSigma > 0) {
        alphaMask = await sharp(alphaMask)
          .blur(blurSigma)
          .png()
          .toBuffer();
      }

      // 步骤 4：用模糊后的 alpha 填充发光颜色
      // 注意：单通道 PNG 不能直接做 dest-in 源（sharp 会解码成 3 通道 sRGB，alpha=255）
      // 必须先用 alphaToMask 转成 RGBA 白色遮罩，渐变才会生效
      const glowMask = await this.alphaToMask(alphaMask, totalW, totalH);
      const glowColor = this.parseColorToRgba(glow.color, glow.opacity);
      const glowShape = await sharp({
        create: { width: totalW, height: totalH, channels: 4, background: glowColor },
      })
        .composite([{
          input: glowMask,
          blend: 'dest-in',
        }])
        .png()
        .toBuffer();

      // 步骤 5：把原图层放在发光上面
      const result = await sharp(glowShape)
        .composite([{ input: buffer, left: pad, top: pad }])
        .png()
        .toBuffer();

      return {
        buffer: result,
        offsetX: -pad,
        offsetY: -pad,
        width: totalW,
        height: totalH,
      };
    } catch (e) {
      debugLog('外发光失败:', e.message);
      return { buffer, offsetX: 0, offsetY: 0, width: layerW, height: layerH };
    }
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
    // 注意：sharp 从 PNG 解码单通道灰度图时默认转成 3 通道 sRGB
    // 必须用 toColorspace('b-w') 强制单通道，否则像素索引完全错乱
    const { data: srcData, info } = await sharp(alphaBuffer)
      .toColorspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const srcW = info.width;
    const srcH = info.height;

    // 灰度形态学膨胀（圆形结构元素，对应 PS 的 round join 圆角描边）
    // 输出像素 = 结构元素范围内最大的 alpha 值（保留抗锯齿渐变）
    const radius = Math.round(size);
    const r2 = radius * radius;
    const outData = Buffer.alloc(srcW * srcH);

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        let maxAlpha = 0;
        const yStart = Math.max(0, y - radius);
        const yEnd = Math.min(srcH - 1, y + radius);

        for (let yy = yStart; yy <= yEnd; yy++) {
          const dy = yy - y;
          const dxMax = Math.floor(Math.sqrt(r2 - dy * dy));
          const xStart = Math.max(0, x - dxMax);
          const xEnd = Math.min(srcW - 1, x + dxMax);

          for (let xx = xStart; xx <= xEnd; xx++) {
            const val = srcData[yy * srcW + xx];
            if (val > maxAlpha) maxAlpha = val;
          }
        }

        outData[y * srcW + x] = maxAlpha;
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
    // 注意：sharp 从 PNG 解码单通道灰度图时默认转成 3 通道 sRGB
    // 必须用 toColorspace('b-w') 强制单通道，否则像素索引完全错乱
    const { data: srcData, info } = await sharp(alphaBuffer)
      .toColorspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const srcW = info.width;
    const srcH = info.height;

    // 灰度形态学侵蚀（圆形结构元素，对应 PS 的 round join 圆角效果）
    // 输出像素 = 结构元素范围内最小的 alpha 值（保留抗锯齿渐变）
    // 边界外的像素视为透明（0）
    const radius = Math.round(size);
    const r2 = radius * radius;
    const outData = Buffer.alloc(srcW * srcH);

    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        let minAlpha = 255;
        const yStart = y - radius;
        const yEnd = y + radius;

        for (let yy = yStart; yy <= yEnd; yy++) {
          const dy = yy - y;
          const dxMax = Math.floor(Math.sqrt(r2 - dy * dy));
          const xStart = x - dxMax;
          const xEnd = x + dxMax;

          for (let xx = xStart; xx <= xEnd; xx++) {
            // 边界外视为透明（0）
            if (xx < 0 || xx >= srcW || yy < 0 || yy >= srcH) {
              minAlpha = 0;
              break;
            }
            const val = srcData[yy * srcW + xx];
            if (val < minAlpha) minAlpha = val;
          }
          if (minAlpha === 0) break;
        }

        outData[y * srcW + x] = minAlpha;
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
