/**
 * 文字渲染工具
 * 用 Canvas 在前端渲染文字为图片（保留字体与 PSD 一致）
 * 
 * 核心思路：用户电脑有什么字体就用什么字体渲染，转成透明底 PNG 传给后端合成
 * 如果用户电脑没有 PSD 里的字体，动态加载免费商用 Web Font 兜底
 */

export interface TextStyle {
  fontFamily: string;        // 字体名，支持逗号分隔的字体栈
  fontSize: number;    // 字号（px）
  color: string;       // 颜色，如 '#ffffff'
  fontWeight?: string | number; // 字重：normal/bold/100-900
  textAlign?: 'left' | 'center' | 'right'; // 对齐方式
  lineHeight?: number;  // 行高（px）
  letterSpacing?: number; // 字间距（px）
}

export interface RenderTextOptions {
  text: string;
  style: TextStyle;
  width: number;      // 图层宽度
  height: number;     // 图层高度
}

/**
 * 免费商用字体映射表
 * key: PSD 中可能出现的字体名（小写，去前缀后缀模糊匹配）
 * value: { family: CSS font-family, weights: { 字重: 字体文件URL } }
 * 
 * 收录原则：免费商用、有中文、字重齐全、加载速度可接受
 */
const FONT_LIBRARY: Array<{
  match: RegExp;          // 匹配规则
  family: string;         // CSS font-family
  weights: Record<string, string>; // 字重 → 字体文件 URL
}> = [
  // 思源黑体 (Source Han Sans / Noto Sans SC) —— Adobe + Google 联合出品，免费商用
  // 使用 loli.net 国内镜像（替代 Google Fonts，国内访问更稳定）
  {
    match: /sourcehansans|noto+sans+sc|思源黑体|siyuanhei/,
    family: '"Noto Sans SC"',
    weights: {
      '100': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYxNbPzS5HE.woff2', // Thin
      '300': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYNfbPzS5HE.woff2', // Light
      '400': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYlvbPzS5HE.woff2', // Regular
      '500': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnY51YPzS5HE.woff2', // Medium
      '700': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYZ5UfzS5HE.woff2', // Bold
      '900': 'https://fonts.loli.net/s/notosanssc/v37/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYqNUfzS5HE.woff2', // Black / Heavy
    },
  },
  // 阿里巴巴普惠体（阿里云 CDN，国内稳定）
  {
    match: /alibabapuhuiti|alibaba.*pu|阿里普惠|普惠体/,
    family: '"Alibaba PuHuiTi"',
    weights: {
      '400': 'https://puhuiti.oss-cn-hangzhou.aliyuncs.com/AlibabaPuHuiTi3/AlibabaPuHuiTi3-55/AlibabaPuHuiTi3-55-Regular.woff2',
      '700': 'https://puhuiti.oss-cn-hangzhou.aliyuncs.com/AlibabaPuHuiTi3/AlibabaPuHuiTi3-85/AlibabaPuHuiTi3-85-Bold.woff2',
    },
  },
];

// 字重映射：PSD 里的字重关键词/数值 → CSS 标准字重数值
const WEIGHT_MAP: Record<string, string> = {
  'thin': '100',
  'extralight': '200',
  'ultralight': '200',
  'light': '300',
  'normal': '400',
  'regular': '400',
  'book': '400',
  'medium': '500',
  'demibold': '600',
  'semibold': '600',
  'bold': '700',
  'extrabold': '800',
  'ultrabold': '800',
  'heavy': '900',
  'black': '900',
  'ultrablack': '950',
};

// 已加载的字体缓存（避免重复注入 @font-face）
const loadedFonts = new Set<string>();

/**
 * 从字体名中提取字重信息
 * 比如 "SourceHanSansCN-Heavy" → { family: "SourceHanSansCN", weight: "900" }
 */
function extractWeightFromFontName(fontName: string): { family: string; weight: string } {
  // 去掉后缀，提取字体族名和字重
  const parts = fontName.split(/[-_]/);
  const lastPart = parts[parts.length - 1].toLowerCase();
  const weight = WEIGHT_MAP[lastPart];
  if (weight) {
    return {
      family: parts.slice(0, -1).join('-'),
      weight,
    };
  }
  return { family: fontName, weight: '400' };
}

/**
 * 匹配字体库，找到对应的免费商用字体
 */
function matchFontLibrary(fontFamily: string): { family: string; weights: Record<string, string> } | null {
  const lower = fontFamily.toLowerCase().replace(/\s+/g, '');
  for (const font of FONT_LIBRARY) {
    if (font.match.test(lower)) {
      return { family: font.family, weights: font.weights };
    }
  }
  return null;
}

/**
 * 找到最接近的字重
 */
function findClosestWeight(weights: Record<string, string>, targetWeight: string): string {
  const target = parseInt(targetWeight, 10);
  const available = Object.keys(weights).map(Number).sort((a, b) => a - b);
  if (available.length === 0) return '400';
  let closest = available[0];
  let minDiff = Math.abs(closest - target);
  for (const w of available) {
    const diff = Math.abs(w - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = w;
    }
  }
  return String(closest);
}

/**
 * 动态加载 Web Font
 * 注入 @font-face 到 document.head
 */
function loadWebFont(family: string, weight: string, url: string): Promise<void> {
  const cacheKey = `${family}-${weight}`;
  if (loadedFonts.has(cacheKey)) return Promise.resolve();

  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: ${family};
        font-weight: ${weight};
        src: url(${url}) format('woff2');
        font-display: swap;
      }
    `;
    document.head.appendChild(style);
    loadedFonts.add(cacheKey);

    // 等待字体加载完成
    if (document.fonts && document.fonts.load) {
      document.fonts.load(`${weight} 12px ${family}`).then(
        () => resolve(),
        () => resolve(), // 加载失败也继续，用兜底字体
      );
    } else {
      // 不支持 Font Loading API 的话，给个超时兜底
      setTimeout(resolve, 1500);
    }
  });
}

/**
 * 准备字体：检测本地是否有，没有的话尝试加载 Web Font
 * 返回实际使用的 CSS font-family 字符串
 */
async function prepareFont(style: TextStyle): Promise<string> {
  const { family: psdFamily, weight: psdWeight } = extractWeightFromFontName(style.fontFamily);
  const targetWeight = typeof style.fontWeight === 'number'
    ? String(style.fontWeight)
    : (WEIGHT_MAP[String(style.fontWeight || '').toLowerCase()] || psdWeight);

  // 先匹配字体库：PSD 里出现这些字体名，说明设计师用的就是这款
  // 90% 的用户电脑没装思源黑体之类的专业字体，直接加载 Web Font 更稳
  const matched = matchFontLibrary(psdFamily);
  if (matched) {
    const closestWeight = findClosestWeight(matched.weights, targetWeight);
    const fontUrl = matched.weights[closestWeight];
    if (fontUrl) {
      try {
        await loadWebFont(matched.family, closestWeight, fontUrl);
        return `${matched.family}, sans-serif`;
      } catch (e) {
        console.warn('Web Font 加载失败，尝试本地字体:', psdFamily, e);
      }
    }
  }

  // 没匹配到字体库，再检测本地是否已有该字体
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      const localAvail = await document.fonts.check(`${targetWeight} 12px "${psdFamily}"`);
      if (localAvail) {
        return `"${psdFamily}", sans-serif`;
      }
    } catch (e) {
      // 检测失败继续
    }
  }

  // 都不行就用系统默认 sans-serif
  return `Microsoft YaHei, "微软雅黑", sans-serif`;
}

/**
 * 等待字体加载完成（旧方法，兼容保留）
 */
async function waitForFonts(fontFamily: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;

  try {
    const firstFont = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
    if (firstFont && firstFont !== 'sans-serif' && firstFont !== 'serif') {
      await document.fonts.load(`12px "${firstFont}"`);
    }
  } catch (e) {
    // 字体加载失败也不影响，继续用兜底字体
  }
}

/**
 * 将文字按宽度自动换行（canvas 不支持自动换行，手动计算）
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }

    let currentLine = '';
    for (const char of paragraph) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = char;
      } else {
          currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * 渲染文字为透明底 PNG 图片
 * 返回 base64 data URL
 */
export async function renderTextToImage(options: RenderTextOptions): Promise<string> {
  const { text, style, width, height } = options;

  // 准备字体：检测本地 → 加载 Web Font → 兜底
  const fontFamily = await prepareFont(style);

  // 从字体名中提取字重
  const { weight: weightFromName } = extractWeightFromFontName(style.fontFamily);
  const fontWeight = style.fontWeight || weightFromName || 'normal';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 设置文字样式
  const fontSize = style.fontSize;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'top';

  // 对齐方式
  const textAlign = style.textAlign || 'left';
  ctx.textAlign = textAlign;

  // 字间距
  if (style.letterSpacing) {
    // letterSpacing 部分浏览器支持，手动处理更稳
  }

  // 行高
  const lineHeight = style.lineHeight || fontSize * 1.2;

  // 自动换行
  const lines = wrapText(ctx, text, width);

  // 计算垂直居中（总文字块垂直居中）
  const totalTextHeight = lines.length * lineHeight;
  let startY = (height - totalTextHeight) / 2;

  // 绘制每行文字
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x: number;
    switch (textAlign) {
      case 'center':
        x = width / 2;
        break;
      case 'right':
        x = width;
        break;
      case 'left':
      default:
        x = 0;
        break;
    }
    ctx.fillText(line, x, startY + i * lineHeight);
  }

  // 转成 base64
  return canvas.toDataURL('image/png');
}

/**
 * 批量渲染多个文字层
 */
export async function renderTextLayersToImages(
  layers: Array<{ layerId: string; text: string; style: TextStyle; width: number; height: number }>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const layer of layers) {
    result[layer.layerId] = await renderTextToImage({
      text: layer.text,
      style: layer.style,
      width: layer.width,
      height: layer.height,
    });
  }
  return result;
}
