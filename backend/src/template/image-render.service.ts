import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
import * as JSZip from 'jszip';
import { FontMatcherService } from './font-matcher.service';

export interface RenderLayer {
  id: string;
  name: string;
  type: 'text' | 'image' | 'shape' | 'group';
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  textContent?: string;
  textStyle?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    fontWeight?: string | number;
    textAlign?: string;
    lineHeight?: number;
    letterSpacing?: number;
  };
  imageUrl?: string;
  children?: RenderLayer[];
  /** 内部标记：图层内容是否被替换（用于决定渲染方式） */
  _replaced?: boolean;
}

export interface RenderSize {
  name: string;
  width: number;
  height: number;
  fitStrategy?: 'contain' | 'cover' | 'stretch';
}

export interface RenderResult {
  sizeName: string;
  width: number;
  height: number;
  url: string;
  filePath: string;
  fileSize: number;
}

export interface RenderOptions {
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  outputDir?: string;
}

@Injectable()
export class ImageRenderService {
  constructor(private readonly fontMatcher: FontMatcherService) {}
  /**
   * 单张渲染（原始尺寸）
   * @param layers 可编辑图层（只渲染需要替换的图层）
   * @param width 画布宽度
   * @param height 画布高度
   * @param replaceContent 替换内容
   * @param baseImagePath 底图路径（PSD 预览图），如果提供则用底图作为背景
   * @param options 渲染选项
   */
  async renderSingle(
    layers: RenderLayer[],
    width: number,
    height: number,
    replaceContent: {
      texts?: Array<{ layerId: string; content: string; style?: any }>;
      images?: Array<{ layerId: string; url: string }>;
    },
    baseImagePath?: string,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const format = options.format || 'png';
    const quality = options.quality || 90;
    const outputDir = options.outputDir || path.join(process.cwd(), 'uploads', 'render');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 应用替换内容到图层
    const mergedLayers = this.applyReplaceContent(layers, replaceContent);

    // 逐层渲染所有图层
    const buffer = await this.renderAllLayers(mergedLayers, width, height);

    const taskId = Date.now().toString();
    const fileName = `${taskId}.${format}`;
    const filePath = path.join(outputDir, fileName);

    let sharpInstance = sharp(buffer);
    if (format === 'jpeg') {
      sharpInstance = sharpInstance.jpeg({ quality });
    } else if (format === 'webp') {
      sharpInstance = sharpInstance.webp({ quality });
    } else {
      sharpInstance = sharpInstance.png();
    }

    await sharpInstance.toFile(filePath);

    const stats = fs.statSync(filePath);
    return {
      sizeName: '原始尺寸',
      width,
      height,
      url: `/uploads/render/${fileName}`,
      filePath,
      fileSize: stats.size,
    };
  }

  /**
   * 批量渲染图片
   */
  async renderBatch(
    layers: RenderLayer[],
    baseWidth: number,
    baseHeight: number,
    targetSizes: RenderSize[],
    replaceContent: {
      texts?: Array<{ layerId: string; content: string; style?: any }>;
      images?: Array<{ layerId: string; url: string }>;
    },
    options: RenderOptions = {},
  ): Promise<RenderResult[]> {
    const format = options.format || 'png';
    const quality = options.quality || 90;
    const outputDir = options.outputDir || path.join(process.cwd(), 'uploads', 'render');

    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 应用替换内容到图层
    const mergedLayers = this.applyReplaceContent(layers, replaceContent);

    // 先渲染原始尺寸的完整图
    const baseBuffer = await this.renderBaseImage(mergedLayers, baseWidth, baseHeight);

    // 批量生成各尺寸
    const results: RenderResult[] = [];
    const taskId = Date.now().toString();

    for (const size of targetSizes) {
      const fileName = `${taskId}_${size.name.replace(/\s+/g, '_')}.${format}`;
      const filePath = path.join(outputDir, fileName);

      // 使用 sharp 调整尺寸
      let sharpInstance = sharp(baseBuffer);
      const fitStrategy = size.fitStrategy || 'cover';

      if (fitStrategy === 'stretch') {
        sharpInstance = sharpInstance.resize(size.width, size.height, { fit: 'fill' });
      } else if (fitStrategy === 'contain') {
        sharpInstance = sharpInstance.resize(size.width, size.height, {
          fit: 'contain',
          background: 'white',
        });
      } else {
        // cover
        sharpInstance = sharpInstance.resize(size.width, size.height, { fit: 'cover' });
      }

      if (format === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality });
      } else if (format === 'webp') {
        sharpInstance = sharpInstance.webp({ quality });
      } else {
        sharpInstance = sharpInstance.png();
      }

      await sharpInstance.toFile(filePath);

      const stats = fs.statSync(filePath);
      results.push({
        sizeName: size.name,
        width: size.width,
        height: size.height,
        url: `/uploads/render/${fileName}`,
        filePath,
        fileSize: stats.size,
      });
    }

    return results;
  }

  /**
   * 解析图片路径（支持相对路径和完整 URL）
   */
  private resolveImagePath(imagePath: string): string | null {
    if (!imagePath) return null;

    // 如果是完整 URL（http:// 或 https:// 开头），提取路径部分
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      try {
        const url = new URL(imagePath);
        imagePath = url.pathname; // 提取 /uploads/images/xxx.png
      } catch (e) {
        return null;
      }
    }

    // 如果是本地路径（/uploads/开头），转成绝对路径
    if (imagePath.startsWith('/uploads/')) {
      return path.join(process.cwd(), imagePath);
    }

    // 已经是绝对路径
    if (path.isAbsolute(imagePath)) {
      return imagePath;
    }

    return null;
  }

  /**
   * 逐层渲染所有图层（全量渲染模式）
   * 从白色背景开始，从底到顶逐层合成所有图层
   * 文字层用 SVG 渲染（支持替换），其他层用图层图片合成
   */
  private async renderAllLayers(
    layers: RenderLayer[],
    width: number,
    height: number,
  ): Promise<Buffer> {
    // 创建白色背景
    let buffer: Buffer = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: 'white',
      },
    }).png().toBuffer() as Buffer;

    // 扁平化图层（ag-psd 的 children 是从下到上的顺序，直接按顺序合成即可）
    const flatLayers = this.flattenLayers(layers);

    // 逐层合成
    for (let i = 0; i < flatLayers.length; i++) {
      const layer = flatLayers[i];
      if (layer.visible === false) continue;

      try {
        if (layer.imageUrl) {
          // 有图片的图层直接合成（未替换的文字层用原始图层图片，
          // 被替换且传了图片的文字层也用图片合成，效果最好）
          // 图片层不管替换与否，只要有 imageUrl 都用图片合成
          buffer = await this.compositeImageLayer(buffer, layer);
        } else if (layer.type === 'text' && layer._replaced) {
          // 兜底：被替换的文字层没有图片（前端没传），用 SVG 渲染
          buffer = await this.compositeTextLayer(buffer, layer);
        }
        // 没有图片也不需要 SVG 渲染的图层跳过
      } catch (e: any) {
        console.error(`[Render] 图层 ${i + 1}/${flatLayers.length}: ${layer.name} 合成失败:`, e.message);
        // 单个图层失败不影响整体，继续下一个
      }
    }

    return buffer;
  }

  /**
   * 在底图上合成图层（只合成文字层和图片层）
   * @deprecated 已废弃，改用 renderAllLayers 全量渲染模式
   */
  private async renderLayersOntoBase(
    baseBuffer: Buffer,
    layers: RenderLayer[],
  ): Promise<Buffer> {
    let buffer = baseBuffer;

    // 按图层顺序从下到上合成
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      // visible 为 false 才跳过，undefined 默认为可见
      if (layer.visible === false) {
        continue;
      }

      try {
        if (layer.type === 'text') {
          buffer = await this.compositeTextLayer(buffer, layer);
        } else if (layer.type === 'image') {
          buffer = await this.compositeImageLayer(buffer, layer);
        }
        // shape 层不用合成，因为底图里已经有了
      } catch (e: any) {
        console.error(`[Render] 图层 ${i + 1}/${layers.length}: ${layer.name} 合成失败:`, e.message);
        // 单个图层失败不影响整体，继续下一个
      }
    }

    console.log(`[Render] 所有图层合成完成`);
    return buffer;
  }

  /**
   * 渲染基础图（原始尺寸）
   */
  private async renderBaseImage(
    layers: RenderLayer[],
    width: number,
    height: number,
  ): Promise<Buffer> {
    // 创建白色背景
    let pipeline = sharp({
      create: {
        width,
        height,
        channels: 4,
        background: 'white',
      },
    }).png();

    // 扁平化图层（ag-psd 的 children 是从下到上的顺序，直接按顺序合成即可）
    const flatLayers = this.flattenLayers(layers);

    // 逐个合成图层
    let currentBuffer: Buffer = await pipeline.toBuffer() as Buffer;

    for (const layer of flatLayers) {
      if (layer.visible === false) continue;
      currentBuffer = await this.renderLayer(currentBuffer, layer, width, height) as Buffer;
    }

    return currentBuffer;
  }

  /**
   * 渲染单个图层并合成
   */
  private async renderLayer(
    baseBuffer: Buffer,
    layer: RenderLayer,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<Buffer> {
    if (layer.imageUrl) {
      // 有图片的图层直接合成（优先级最高，效果最好）
      return this.compositeImageLayer(baseBuffer, layer);
    } else if (layer.type === 'text' && layer._replaced && layer.textContent) {
      // 兜底：被替换的文字层没有图片，用 SVG 渲染
      return this.compositeTextLayer(baseBuffer, layer);
    } else if (layer.type === 'shape') {
      return this.compositeShapeLayer(baseBuffer, layer);
    }
    return baseBuffer;
  }

  /**
   * 合成图片层
   */
  private async compositeImageLayer(baseBuffer: Buffer, layer: RenderLayer): Promise<Buffer> {
    try {
      const imagePath = this.resolveImagePath(layer.imageUrl || '');

      if (!imagePath || !fs.existsSync(imagePath)) {
        // 图片不存在，返回灰色占位
        return this.compositeShapeLayer(baseBuffer, layer);
      }

      // 调整图片尺寸到图层大小
      const resizedImage = await sharp(imagePath)
        .resize(layer.width, layer.height, { fit: 'cover' })
        .ensureAlpha()
        .png()
        .toBuffer();

      // 应用透明度
      const opacity = layer.opacity != null ? layer.opacity : 1;
      let finalImage = resizedImage;
      if (opacity < 1) {
        finalImage = await sharp(resizedImage)
          .composite([{
            input: Buffer.from([255, 255, 255, Math.round(opacity * 255)]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: 'dest-in',
          }])
          .png()
          .toBuffer();
      }

      // 合成到基础图
      return sharp(baseBuffer)
        .composite([{
          input: finalImage,
          left: Math.round(layer.x),
          top: Math.round(layer.y),
        }])
        .png()
        .toBuffer();
    } catch (e) {
      console.warn('图片层合成失败:', layer.name, e);
      return baseBuffer;
    }
  }

  /**
   * 合成文字层（用 SVG 渲染文字）
   *
   * 关键原理（经过精确像素测量验证）：
   * 1. PSD 字号 vs SVG 字号：PSD 的文字像素比同字号 SVG 大约 1.29 倍
   *    （PSD 59px 字高 74px，SVG 59px 字高 57px）
   *    所以需要 fontSizeScale ≈ 1.29 的补偿
   *
   * 2. 基线定位：改用 alphabetic 基线 + 手动计算 ascent
   *    dominant-baseline="text-before-edge" 在 librsvg 中文字顶部
   *    会比 y 坐标高出几像素，不可靠
   *    改用 y = ascent（约 0.86em）+ 基线定位更精确
   *
   * 3. 图层坐标系：ag-psd 的 layer.top/left 是文字像素边界框
   *    （紧贴文字，上下无留白），不是 PSD 的文字框
   *    所以 SVG 渲染也应该让文字紧贴容器顶部
   *
   * 4. 行高：PSD 的 leading 是两行基线之间的距离
   *    用 lineHeight 直接作为每行基线的 y 偏移增量
   */
  private async compositeTextLayer(baseBuffer: Buffer, layer: RenderLayer): Promise<Buffer> {
    try {
      const style = layer.textStyle || {};
      let fontSize = style.fontSize || 24;
      const psdFontFamily = style.fontFamily || 'Microsoft YaHei';
      const psdFontWeight = style.fontWeight;
      let color = style.color || '#333333';
      const textAlign = style.textAlign || 'left';
      const psdLineHeight = style.lineHeight;
      const letterSpacing = style.letterSpacing || 0;
      const opacity = layer.opacity != null ? layer.opacity : 1;

      // 字体匹配：PSD 字体名 → 服务器实际字体
      const matched = this.fontMatcher.matchFont(psdFontFamily, psdFontWeight);
      const fontFamily = matched.fontFamily;
      const fontWeight = matched.fontWeight;

      // 处理颜色格式
      if (Array.isArray(color)) {
        const [r, g, b, a] = color;
        color = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a != null ? a : 1})`;
      }

      // 确保 fontSize 是数字
      if (typeof fontSize === 'string') {
        fontSize = parseFloat(fontSize) || 24;
      }

      // ===== 字号补偿 =====
      // PSD 的字号度量和 SVG(librsvg) 不同，需要乘以补偿系数
      // 经像素级精确测量：Noto Sans SC 下 PSD文字像素 / SVG同字号文字像素 ≈ 1.30
      // （59px Heavy: PSD字高74px / SVG字高57px ≈ 1.30）
      // 这个系数让 SVG 渲染的文字像素大小刚好等于 PSD 图层大小
      const FONT_SIZE_SCALE = 1.30;
      const actualFontSize = Math.round(fontSize * FONT_SIZE_SCALE);

      // ===== 行高 =====
      // PSD 的 leading 是行高绝对值（两行基线之间的距离）
      const lineHeight = psdLineHeight
        ? Math.round(psdLineHeight * FONT_SIZE_SCALE)
        : Math.round(actualFontSize * 1.2);

      const text = layer.textContent || '';
      const lines = text.split('\n');

      // SVG 画布设大一些，留足够空间，避免文字被裁切
      // 后面会测量实际边界再精确定位
      const svgCanvasW = Math.max(400, Math.round((layer.width || 200) * 1.5));
      const svgCanvasH = Math.max(200, Math.round((layer.height || actualFontSize * 1.2) * 2));

      // 基线往下放，给顶部留足够空间
      const baselineOffset = Math.round(actualFontSize * 1.0); // 从顶部往下 1em 左右作为基线起点
      const firstLineBaselineY = baselineOffset;

      // 字间距也要跟着缩放
      const letterSpacingStyle = letterSpacing ? `letter-spacing:${letterSpacing * FONT_SIZE_SCALE}px;` : '';

      // SVG text-anchor 值: start | middle | end
      const textAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';

      // 构建 SVG 文本
      const svgText = lines.map((line, index) => {
        // 在大画布中用左对齐起点，方便测量
        // 水平位置先设为中间，后面根据测量结果调整合成的 left
        let x = svgCanvasW / 2;
        if (textAlign === 'start' || textAlign === 'left') x = 10; // 左边留 10px
        if (textAlign === 'end' || textAlign === 'right') x = svgCanvasW - 10;

        // 每行的基线 y 坐标
        const y = firstLineBaselineY + index * lineHeight;

        return `<text 
          x="${x}" 
          y="${y}" 
          font-family='${fontFamily}' 
          font-size="${actualFontSize}" 
          font-weight="${fontWeight}" 
          fill="${color}" 
          text-anchor="${textAnchor}"
          dominant-baseline="alphabetic"
          opacity="${opacity}"
          style="${letterSpacingStyle}">${this.escapeXml(line)}</text>`;
      }).join('');

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
        <svg width="${svgCanvasW}" height="${svgCanvasH}" xmlns="http://www.w3.org/2000/svg">
          ${svgText}
        </svg>
      `;

      const textBuffer = Buffer.from(svg);

      // ===== 精确像素定位 =====
      // 1. 先渲染 SVG 到大画布
      // 2. 测量文字像素边界框
      // 3. 裁剪掉周围空白
      // 4. 合成到图层的正确位置（像素顶部对齐图层顶部，水平按对齐方式定位）
      const textImg = sharp(textBuffer).png();
      const { data: rawData, info } = await textImg.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

      // 测量不透明像素的边界框
      let minY = info.height, maxY = -1, minX = info.width, maxX = -1;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const idx = (y * info.width + x) * 4;
          const alpha = rawData[idx + 3];
          if (alpha > 10) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }

      if (minY > maxY || minX > maxX) {
        // 文字为空，直接返回
        return baseBuffer;
      }

      const textPixelW = maxX - minX + 1;
      const textPixelH = maxY - minY + 1;

      // 裁剪出文字的精确像素图
      const croppedBuffer = await sharp(textBuffer)
        .extract({ left: minX, top: minY, width: textPixelW, height: textPixelH })
        .png()
        .toBuffer();

      // 计算合成位置：
      // - 垂直：像素顶部对齐图层顶部（和 PSD ag-psd 的图层坐标系一致）
      // - 水平：根据对齐方式定位
      let compLeft = Math.round(layer.x);
      const compTop = Math.round(layer.y); // 像素顶部 = 图层顶部

      if (textAlign === 'center') {
        compLeft = Math.round(layer.x + (layer.width - textPixelW) / 2);
      } else if (textAlign === 'right' || textAlign === 'end') {
        compLeft = Math.round(layer.x + layer.width - textPixelW);
      }
      // left/start: 左对齐，compLeft = layer.x

      // 合成文字（用精确裁剪后的文字图，直接放到正确位置）
      return sharp(baseBuffer)
        .composite([{
          input: croppedBuffer,
          left: compLeft,
          top: compTop,
        }])
        .png()
        .toBuffer();
    } catch (e) {
      console.warn('文字层合成失败:', layer.name, e.message);
      return baseBuffer;
    }
  }

  /**
   * 合成形状层（灰色矩形占位）
   */
  private async compositeShapeLayer(baseBuffer: Buffer, layer: RenderLayer): Promise<Buffer> {
    try {
      const shapeBuffer = await sharp({
        create: {
          width: Math.max(1, Math.round(layer.width)),
          height: Math.max(1, Math.round(layer.height)),
          channels: 4,
          background: '#cccccc',
        },
      }).png().toBuffer();

      return sharp(baseBuffer)
        .composite([{
          input: shapeBuffer,
          left: Math.round(layer.x),
          top: Math.round(layer.y),
        }])
        .png()
        .toBuffer();
    } catch (e) {
      return baseBuffer;
    }
  }

  /**
   * 生成打包ZIP
   */
  async createZip(results: RenderResult[], zipPath: string): Promise<string> {
    const zip = new JSZip();

    for (const result of results) {
      const data = fs.readFileSync(result.filePath);
      zip.file(`${result.sizeName}.${this.getExt(result.url)}`, data);
    }

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    fs.writeFileSync(zipPath, content);

    return zipPath;
  }

  private getExt(url: string): string {
    const match = url.match(/\.(\w+)$/);
    return match ? match[1] : 'png';
  }

  /**
   * 应用替换内容到图层
   */
  private applyReplaceContent(
    layers: RenderLayer[],
    replaceContent: { texts?: any[]; images?: any[] },
  ): RenderLayer[] {
    const textMap = new Map();
    const imageMap = new Map();

    (replaceContent.texts || []).forEach(t => textMap.set(t.layerId, t));
    (replaceContent.images || []).forEach(i => imageMap.set(i.layerId, i));

    const apply = (layer: RenderLayer): RenderLayer => {
      if (layer.type === 'group' && layer.children) {
        return { ...layer, children: layer.children.map(apply) };
      }

      const textReplace = textMap.get(layer.id);
      const imageReplace = imageMap.get(layer.id);

      // 文字层 + 有图片替换 → 直接用图片合成（字体最准确）
      if (imageReplace && layer.type === 'text') {
        return { ...layer, _replaced: true, imageUrl: imageReplace.url };
      }

      // 文字层 + 只有文字替换（没有图片）→ 用 SVG 渲染
      if (textReplace && layer.type === 'text') {
        return {
          ...layer,
          _replaced: true,
          textContent: textReplace.content,
          textStyle: { ...layer.textStyle, ...textReplace.style },
          imageUrl: undefined, // 清除原始图层图片，强制走 SVG 渲染路径
        };
      }

      // 图片层 + 有图片替换
      if (imageReplace && layer.type === 'image') {
        return { ...layer, _replaced: true, imageUrl: imageReplace.url };
      }

      return layer;
    };

    return layers.map(apply);
  }

  /**
   * 扁平化图层树
   */
  private flattenLayers(layers: RenderLayer[]): RenderLayer[] {
    const result: RenderLayer[] = [];
    for (const layer of layers) {
      if (layer.type === 'group' && layer.children) {
        result.push(...this.flattenLayers(layer.children));
      } else {
        result.push(layer);
      }
    }
    return result;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
