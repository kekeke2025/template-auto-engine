import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// import { readPsd } from 'ag-psd'; // 暂时禁用，排查原生崩溃问题

export interface ParsedLayer {
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
    fontWeight?: string;
    textAlign?: string;
    lineHeight?: number;
  };
  imageUrl?: string;
  children?: ParsedLayer[];
}

export interface ParsedPsdResult {
  width: number;
  height: number;
  dpi: number;
  layers: ParsedLayer[];
}

@Injectable()
export class PsdParserService {
  private layerCounter = 0;

  /**
   * 解析PSD文件
   * @param filePath PSD文件本地路径
   * @param outputDir 图片资源输出目录
   */
  async parsePsd(filePath: string, outputDir: string): Promise<ParsedPsdResult> {
    try {
      // 临时：返回 Mock 数据，排查 ag-psd 原生崩溃问题
      // const buffer = fs.readFileSync(filePath);
      // const psd = readPsd(buffer, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });

      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      this.layerCounter = 0;

      // Mock 数据
      return {
        width: 1080,
        height: 1920,
        dpi: 72,
        layers: [
          { id: 'layer_1', name: '主标题', type: 'text', visible: true, x: 100, y: 200, width: 880, height: 100, opacity: 1, textContent: '两岸圆桌派', textStyle: { fontFamily: 'Microsoft YaHei', fontSize: 72, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' } },
          { id: 'layer_2', name: '副标题', type: 'text', visible: true, x: 100, y: 350, width: 880, height: 50, opacity: 1, textContent: '重量嘉宾 即将登场', textStyle: { fontFamily: 'Microsoft YaHei', fontSize: 32, color: '#ffffff', textAlign: 'center' } },
          { id: 'layer_3', name: '人物-左', type: 'image', visible: true, x: 50, y: 500, width: 300, height: 500, opacity: 1 },
          { id: 'layer_4', name: '人物-中', type: 'image', visible: true, x: 390, y: 480, width: 300, height: 520, opacity: 1 },
          { id: 'layer_5', name: '人物-右', type: 'image', visible: true, x: 730, y: 500, width: 300, height: 500, opacity: 1 },
        ],
      };
    } catch (error) {
      console.error('PSD解析失败:', error);
      throw new Error('PSD文件解析失败，请检查文件格式');
    }
  }

  /**
   * 递归解析图层组
   */
  private parseLayerGroup(children: any[], outputDir: string): ParsedLayer[] {
    const layers: ParsedLayer[] = [];

    for (const child of children) {
      try {
        const layerInfo = this.extractLayerInfo(child, outputDir);
        if (layerInfo) {
          layers.push(layerInfo);
        }
      } catch (e) {
        console.warn(`解析图层失败: ${child.name}`, e);
      }
    }

    return layers;
  }

  /**
   * 提取单个图层信息
   */
  private extractLayerInfo(layer: any, outputDir: string): ParsedLayer | null {
    const isGroup = layer.children && layer.children.length > 0;
    const isVisible = layer.visible !== false;
    const layerName = layer.name || '未命名图层';

    // 跳过隐藏图层
    if (!isVisible) return null;

    // 获取图层位置和尺寸
    const x = layer.left || 0;
    const y = layer.top || 0;
    const width = Math.max(0, (layer.right || 0) - (layer.left || 0));
    const height = Math.max(0, (layer.bottom || 0) - (layer.top || 0));

    const opacity = layer.opacity != null ? layer.opacity / 255 : 1;

    this.layerCounter++;
    const id = `layer_${this.layerCounter}`;

    // 图层组
    if (isGroup) {
      const childLayers = this.parseLayerGroup(layer.children!, outputDir);
      // 空组跳过
      if (childLayers.length === 0) return null;
      return {
        id,
        name: layerName,
        type: 'group',
        visible: isVisible,
        x,
        y,
        width,
        height,
        opacity,
        children: childLayers,
      };
    }

    // 文字层
    const textData = this.getTextData(layer);
    if (textData) {
      return {
        id,
        name: layerName,
        type: 'text',
        visible: isVisible,
        x,
        y,
        width,
        height,
        opacity,
        textContent: textData.content,
        textStyle: textData.style,
      };
    }

    // 图片层（有像素数据的，暂时不导出图片，只标记类型）
    // 判断依据：非文字、非组、有一定尺寸的图层
    if (width > 0 && height > 0) {
      // 简单判断：如果图层名包含常见图片层关键词，或者尺寸较大，视为图片层
      const isImage = this.isImageLayer(layer);
      if (isImage) {
        return {
          id,
          name: layerName,
          type: 'image',
          visible: isVisible,
          x,
          y,
          width,
          height,
          opacity,
        };
      }
    }

    // 形状层
    return {
      id,
      name: layerName,
      type: 'shape',
      visible: isVisible,
      x,
      y,
      width,
      height,
      opacity,
    };
  }

  /**
   * 判断是否为图片层
   */
  private isImageLayer(layer: any): boolean {
    const name = (layer.name || '').toLowerCase();
    // 常见图片层命名关键词
    const imageKeywords = ['img', 'image', 'pic', 'photo', '图', '照片', '头像', 'logo', 'icon'];
    for (const kw of imageKeywords) {
      if (name.includes(kw)) return true;
    }
    // 没有文字数据，且尺寸大于 50x50 的，大概率是图片层
    const w = (layer.right || 0) - (layer.left || 0);
    const h = (layer.bottom || 0) - (layer.top || 0);
    if (!layer.text && w > 50 && h > 50) return true;
    return false;
  }

  /**
   * 提取文字层数据
   */
  private getTextData(layer: any): { content: string; style: any } | null {
    try {
      const textProps = layer.text?.text;
      if (!textProps) return null;

      const content = textProps || '';
      if (!content || content.trim() === '') return null;

      // 提取文字样式
      const style: any = {};

      // 从 text 基础属性提取
      if (layer.text?.font?.name) {
        style.fontFamily = layer.text.font.name;
      }
      if (layer.text?.font?.sizes?.[0]) {
        style.fontSize = layer.text.font.sizes[0];
      }
      if (layer.text?.alignment?.[0]) {
        const alignMap: Record<string, string> = {
          left: 'left',
          center: 'center',
          right: 'right',
        };
        style.textAlign = alignMap[layer.text.alignment[0]] || 'left';
      }
      // 字体颜色
      if (layer.text?.font?.colors?.[0]) {
        const [r, g, b, a] = layer.text.font.colors[0];
        style.color = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
      }

      return { content, style };
    } catch (e) {
      return null;
    }
  }
}
