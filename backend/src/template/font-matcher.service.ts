import { Injectable } from '@nestjs/common';

/**
 * 字体匹配服务
 * 
 * 功能：
 * 1. 维护服务器已安装的免费商用字体库
 * 2. PSD 字体名 → 服务器实际字体名 的模糊匹配
 * 3. 字重映射（PSD 的字重关键词 → CSS font-weight 数值）
 * 
 * 设计原则：
 * - 服务器预装免费商用字体，用户电脑不需要装任何字体
 * - 尽量匹配 PSD 中的字体，找不到时用最接近的兜底
 * - 所有匹配结果都带字体栈（fallback chain），确保一定能渲染
 */

export interface MatchedFont {
  fontFamily: string;       // 实际使用的 font-family（SVG 里用的）
  fontWeight: number;       // 实际使用的字重
  matched: boolean;         // 是否精确匹配到了
  originalFont: string;     // PSD 里的原始字体名
}

// 字体库定义：PSD 中可能出现的字体名 → 服务器实际字体名
// match 是正则表达式，用于模糊匹配 PSD 字体名
// cssFamily 是 SVG/font-family 里用的实际字体名
interface FontEntry {
  match: RegExp;
  cssFamily: string;
  type: 'sans-serif' | 'serif' | 'monospace' | 'display';
}

const FONT_LIBRARY: FontEntry[] = [
  // ===== 思源黑体（Source Han Sans / Noto Sans SC）=====
  // Adobe + Google 联合出品，免费商用，字重齐全，最常用
  {
    match: /source\s*han\s*sans|noto\s*sans\s*sc|思源黑体|siyuan\s*hei|sourcehansanssc/i,
    cssFamily: 'Noto Sans SC',
    type: 'sans-serif',
  },

  // ===== 思源宋体（Source Han Serif / Noto Serif SC）=====
  {
    match: /source\s*han\s*serif|noto\s*serif\s*sc|思源宋体|siyuan\s*song|sourcehanserifsc/i,
    cssFamily: 'Noto Serif SC',
    type: 'serif',
  },

  // ===== 阿里巴巴普惠体 =====
  {
    match: /alibaba\s*pu\s*hui|阿里.*普惠|普惠体|alibabapuhuiti/i,
    cssFamily: 'Alibaba PuHuiTi',
    type: 'sans-serif',
  },

  // ===== 微软雅黑（系统自带，兜底用）=====
  {
    match: /microsoft\s*yahei|微软雅黑|yahei|msyh/i,
    cssFamily: 'Microsoft YaHei',
    type: 'sans-serif',
  },

  // ===== 黑体（SimHei，系统自带）=====
  {
    match: /simhei|黑体|hei\s*ti/i,
    cssFamily: 'SimHei',
    type: 'sans-serif',
  },

  // ===== 宋体（SimSun，系统自带）=====
  {
    match: /simsun|宋体|song\s*ti/i,
    cssFamily: 'SimSun',
    type: 'serif',
  },

  // ===== 楷体 =====
  {
    match: /kai|楷体|kaiti|simkai/i,
    cssFamily: 'KaiTi',
    type: 'serif',
  },

  // ===== 仿宋 =====
  {
    match: /fangsong|仿宋|simfang/i,
    cssFamily: 'FangSong',
    type: 'serif',
  },
];

// 字重映射：PSD 常见字重关键词/后缀 → CSS font-weight 数值
const WEIGHT_MAP: Record<string, number> = {
  // 细体
  'hairline': 100,
  'ultralight': 100,
  'extra light': 100,
  'thin': 100,
  // 轻量
  'light': 300,
  'extralight': 200,
  'demilight': 300,
  // 常规
  'regular': 400,
  'normal': 400,
  'book': 400,
  'roman': 400,
  // 中等
  'medium': 500,
  'meduim': 500, // 常见拼写错误
  // 半粗
  'semibold': 600,
  'demibold': 600,
  'demi bold': 600,
  // 粗体
  'bold': 700,
  // 特粗
  'extrabold': 800,
  'ultrabold': 800,
  'heavy': 900,
  'black': 900,
  'ultra black': 950,
  'ultrablack': 950,
  'extra bold': 800,
  'extra black': 950,
};

// 常见字重后缀（从字体名中提取字重）
// 比如 "SourceHanSansCN-Heavy" → 提取 Heavy → 900
const WEIGHT_SUFFIX_PATTERNS = [
  /[-_](hairline|thin|light|regular|medium|bold|heavy|black|ultrabold|extrabold|semibold|demibold|book|roman|normal)$/i,
];

@Injectable()
export class FontMatcherService {
  /**
   * 匹配字体：从 PSD 字体名找到服务器上最接近的字体
   */
  matchFont(psdFontFamily: string, psdFontWeight?: string | number): MatchedFont {
    const originalFont = psdFontFamily || '';
    const lower = originalFont.toLowerCase();

    // 1. 从字体名中提取字重
    let weight = this.extractWeight(originalFont, psdFontWeight);

    // 2. 匹配字体库
    for (const entry of FONT_LIBRARY) {
      if (entry.match.test(lower)) {
        return {
          fontFamily: this.buildFontStack(entry.cssFamily, entry.type),
          fontWeight: weight,
          matched: true,
          originalFont,
        };
      }
    }

    // 3. 没匹配到，根据字体风格选兜底
    const fallbackType = this.guessFontType(lower);
    const fallbackFamily = fallbackType === 'serif' ? 'Noto Serif SC' : 'Noto Sans SC';

    return {
      fontFamily: this.buildFontStack(fallbackFamily, fallbackType),
      fontWeight: weight,
      matched: false,
      originalFont,
    };
  }

  /**
   * 从字体名和 style 中提取字重数值
   */
  private extractWeight(fontName: string, explicitWeight?: string | number): number {
    // 优先用显式传入的字重
    if (explicitWeight != null) {
      if (typeof explicitWeight === 'number') return explicitWeight;
      const num = parseInt(explicitWeight, 10);
      if (!isNaN(num) && num >= 100 && num <= 900) return num;
      const key = explicitWeight.toLowerCase().trim();
      if (WEIGHT_MAP[key] != null) return WEIGHT_MAP[key];
    }

    // 从字体名后缀提取（如 SourceHanSansSC-Bold）
    for (const pattern of WEIGHT_SUFFIX_PATTERNS) {
      const match = fontName.match(pattern);
      if (match) {
        const weightKey = match[1].toLowerCase();
        if (WEIGHT_MAP[weightKey] != null) {
          return WEIGHT_MAP[weightKey];
        }
      }
    }

    // 默认 400
    return 400;
  }

  /**
   * 猜测字体类型（无衬线/衬线）
   */
  private guessFontType(lowerFontName: string): 'sans-serif' | 'serif' {
    const serifKeywords = ['serif', 'song', 'ming', '宋体', '明体', '明朝', 'slab', 'serif'];
    for (const kw of serifKeywords) {
      if (lowerFontName.includes(kw)) return 'serif';
    }
    return 'sans-serif';
  }

  /**
   * 构建字体栈（fallback chain）
   * 确保主字体加载失败时还有兜底
   */
  private buildFontStack(primary: string, type: string): string {
    const stack = [primary];
    if (type === 'serif') {
      stack.push('Noto Serif SC', 'SimSun', 'serif');
    } else {
      stack.push('Noto Sans SC', 'Microsoft YaHei', 'SimHei', 'sans-serif');
    }
    return stack.join(', ');
  }

  /**
   * 获取已支持的字体列表（前端展示用）
   */
  getSupportedFonts(): Array<{ name: string; type: string }> {
    return FONT_LIBRARY.map(f => ({
      name: f.cssFamily,
      type: f.type,
    }));
  }
}
