import { readPsd } from 'ag-psd'

export interface ParsedLayerStyle {
  /** 混合模式 */
  blendMode?: string
  /** 填充不透明度（0-1） */
  fillOpacity?: number
  /** 投影（支持多个） */
  dropShadow?: Array<{
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    angle: number
    distance: number
    size: number
    spread: number
    useGlobalLight: boolean
  }>
  /** 内阴影 */
  innerShadow?: Array<{
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    angle: number
    distance: number
    size: number
    choke: number
    useGlobalLight: boolean
  }>
  /** 外发光 */
  outerGlow?: {
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    size: number
    spread: number
  }
  /** 内发光 */
  innerGlow?: {
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    size: number
    choke: number
    source: 'edge' | 'center'
  }
  /** 颜色叠加 */
  colorOverlay?: Array<{
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
  }>
  /** 渐变叠加 */
  gradientOverlay?: Array<{
    enabled: boolean
    blendMode: string
    opacity: number
    angle: number
    scale: number
    style: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
    gradientType: 'solid' | 'noise'
    colorStops: Array<{ color: string; location: number; opacity: number }>
  }>
  /** 描边 */
  stroke?: Array<{
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    size: number
    position: 'inside' | 'center' | 'outside'
    fillType: 'color' | 'gradient' | 'pattern'
  }>
  /** 斜面浮雕 */
  bevel?: {
    enabled: boolean
    style: string
    technique: string
    depth: number
    direction: string
    size: number
    soften: number
    angle: number
    useGlobalLight: boolean
    altitude: number
    highlightBlendMode: string
    shadowBlendMode: string
    highlightColor: string
    shadowColor: string
    highlightOpacity: number
    shadowOpacity: number
  }
  /** 光泽 */
  satin?: {
    enabled: boolean
    blendMode: string
    color: string
    opacity: number
    angle: number
    distance: number
    size: number
    invert: boolean
  }
  /** 图案叠加 */
  patternOverlay?: {
    enabled: boolean
    blendMode: string
    opacity: number
    scale: number
    patternName: string
  }
}

export interface ParsedLayer {
  id: string
  name: string
  type: 'text' | 'image' | 'shape' | 'group'
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  opacity: number
  textContent?: string
  textStyle?: {
    fontFamily?: string
    fontSize?: number
    color?: string
    fontWeight?: string
    textAlign?: string
    lineHeight?: number
    letterSpacing?: number
  }
  imageUrl?: string
  imageData?: string // base64 格式的图层图片（仅上传时使用，用于传给后端保存）
  children?: ParsedLayer[]
  /** 图层样式（effects） */
  layerStyle?: ParsedLayerStyle
}

export interface ParsedPsdResult {
  width: number
  height: number
  dpi: number
  layers: ParsedLayer[]
  previewUrl?: string // PSD 合成预览图（base64）
}

let layerCounter = 0

/**
 * 前端解析 PSD 文件
 */
export async function parsePsdFile(file: File): Promise<ParsedPsdResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer
        const psd = readPsd(buffer, {
          skipLayerImageData: false, // 不跳过图层图片数据，用于逐层渲染
          skipCompositeImageData: false, // 读取合成图用于预览
          skipThumbnail: true,
        })

        layerCounter = 0

        const width = psd.width || 0
        const height = psd.height || 0

        const layers = psd.children
          ? parseLayerGroup(psd.children as any[])
          : []

        // 生成预览图（base64）
        let previewUrl: string | undefined
        if (psd.canvas) {
          previewUrl = psd.canvas.toDataURL('image/png')
        } else if (psd.imageData) {
          // 手动从 imageData 生成 canvas
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const imageData = ctx.createImageData(width, height)
            const data = psd.imageData
            for (let i = 0; i < data.length && i < imageData.data.length; i++) {
              imageData.data[i] = data[i]
            }
            ctx.putImageData(imageData, 0, 0)
            previewUrl = canvas.toDataURL('image/png')
          }
        }

        resolve({
          width,
          height,
          dpi: 72,
          layers,
          previewUrl,
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 递归解析图层组
 */
function parseLayerGroup(children: any[]): ParsedLayer[] {
  const layers: ParsedLayer[] = []

  for (const child of children) {
    try {
      const layerInfo = extractLayerInfo(child)
      if (layerInfo) {
        layers.push(layerInfo)
      }
    } catch (e) {
      console.warn('解析图层失败:', child.name, e)
    }
  }

  return layers
}

/**
 * 提取单个图层信息
 */
function extractLayerInfo(layer: any): ParsedLayer | null {
  const isGroup = layer.children && layer.children.length > 0
  const isVisible = layer.visible !== false
  const layerName = layer.name || '未命名图层'

  // 跳过隐藏图层
  if (!isVisible) return null

  const x = layer.left || 0
  const y = layer.top || 0
  const width = Math.max(0, (layer.right || 0) - (layer.left || 0))
  const height = Math.max(0, (layer.bottom || 0) - (layer.top || 0))
  // ag-psd 的 opacity 是 0-1 范围（1 表示完全不透明）
  const opacity = layer.opacity != null ? layer.opacity : 1

  layerCounter++
  const id = `layer_${layerCounter}`

  // 图层组
  if (isGroup) {
    const childLayers = parseLayerGroup(layer.children as any[])
    if (childLayers.length === 0) return null
    const groupStyle = extractLayerStyle(layer)
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
      layerStyle: groupStyle,
    }
  }

  // 文字层：同时导出文字信息 + 图层渲染图片
  // imageData 用于后端渲染未修改文字时保持和 PSD 完全一致的效果
  const textData = getTextData(layer)
  if (textData) {
    let imageData: string | undefined
    if (layer.canvas && width > 0 && height > 0) {
      try {
        imageData = layer.canvas.toDataURL('image/png')
      } catch (e) {
        console.warn('导出文字图层图片失败:', layerName, e)
      }
    }
    const layerStyle = extractLayerStyle(layer)
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
      imageData,
      layerStyle,
    }
  }

  // 非文字层：导出图层图片为 base64，用于后端逐层渲染
  let imageData: string | undefined
  if (layer.canvas && width > 0 && height > 0) {
    try {
      imageData = layer.canvas.toDataURL('image/png')
    } catch (e) {
      console.warn('导出图层图片失败:', layerName, e)
    }
  }

  // 图片层
  if (isImageLayer(layer)) {
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
      imageData,
      layerStyle: extractLayerStyle(layer),
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
    imageData,
    layerStyle: extractLayerStyle(layer),
  }
}

/**
 * 判断是否为图片层
 */
function isImageLayer(layer: any): boolean {
  const name = (layer.name || '').toLowerCase()
  const imageKeywords = ['img', 'image', 'pic', 'photo', '图', '照片', '头像', 'logo', 'icon']
  for (const kw of imageKeywords) {
    if (name.includes(kw)) return true
  }
  const w = (layer.right || 0) - (layer.left || 0)
  const h = (layer.bottom || 0) - (layer.top || 0)
  if (!layer.text && w > 50 && h > 50) return true
  return false
}

/**
 * 提取文字层数据
 * 兼容 ag-psd 的文字样式结构：layer.text.style / layer.text.paragraphStyle
 */
function getTextData(layer: any): { content: string; style: any } | null {
  try {
    const textProps = layer.text?.text
    if (!textProps) return null

    const content = textProps || ''
    if (!content || content.trim() === '') return null

    const style: any = {}
    const textStyle = layer.text?.style || {}
    const paraStyle = layer.text?.paragraphStyle || {}

    // 字体
    if (textStyle.font?.name) {
      style.fontFamily = textStyle.font.name
    }
    // 字号
    if (textStyle.fontSize != null) {
      style.fontSize = Math.round(textStyle.fontSize)
    }
    // 颜色（fillColor 是 {r, g, b} 格式）
    if (textStyle.fillColor) {
      const { r, g, b } = textStyle.fillColor
      style.color = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
    }
    // 对齐方式
    if (paraStyle.justification) {
      const alignMap: Record<string, string> = {
        left: 'left',
        center: 'center',
        right: 'right',
      }
      style.textAlign = alignMap[paraStyle.justification] || 'left'
    }
    // 行高
    if (textStyle.leading != null && !textStyle.autoLeading) {
      style.lineHeight = Math.round(textStyle.leading)
    }
    // 字间距
    if (textStyle.tracking != null) {
      style.letterSpacing = textStyle.tracking
    }

    return { content, style }
  } catch (e) {
    return null
  }
}

/**
 * 扁平化图层树，只保留叶子节点
 */
export function flattenLayers(layers: ParsedLayer[], prefix = ''): ParsedLayer[] {
  const result: ParsedLayer[] = []
  layers.forEach((layer) => {
    const layerName = prefix ? `${prefix} / ${layer.name}` : layer.name
    if (layer.type === 'group' && layer.children && layer.children.length > 0) {
      result.push(...flattenLayers(layer.children, layerName))
    } else {
      result.push({
        ...layer,
        name: layerName,
      })
    }
  })
  return result
}

// ===================== 图层样式提取 =====================

/**
 * 将 ag-psd 的 Color 转换为 css 字符串
 */
function colorToString(color: any): string {
  if (!color) return '#000000'
  // RGBA 格式
  if (color.r != null && color.g != null && color.b != null) {
    const a = color.a != null ? color.a : 1
    if (a < 1) {
      return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${a})`
    }
    return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
  }
  return '#000000'
}

/**
 * 从 UnitsValue 中提取像素值
 */
function getUnitsPixelValue(uv: any): number {
  if (!uv) return 0
  if (typeof uv === 'number') return uv
  if (uv.value != null) {
    // 都是 Pixels 单位，直接用 value
    return uv.value
  }
  return 0
}

/**
 * 从 ag-psd 图层中提取图层样式（effects）和混合模式
 */
function extractLayerStyle(layer: any): ParsedLayerStyle | undefined {
  const style: ParsedLayerStyle = {}

  // 混合模式
  if (layer.blendMode) {
    style.blendMode = layer.blendMode
  }

  // 填充不透明度
  if (layer.fillOpacity != null) {
    // ag-psd 的 fillOpacity 是 0-255 范围，转成 0-1
    style.fillOpacity = layer.fillOpacity / 255
  }

  // ag-psd v31+ effects 直接在 layer 上（Layer extends LayerAdditionalInfo）
  const effects = layer.effects || layer.additionalLayerInfo?.effects
  if (!effects) {
    if (Object.keys(style).length === 0) return undefined
    return style
  }

  // 投影（支持多个）
  if (effects.dropShadow && effects.dropShadow.length > 0) {
    style.dropShadow = effects.dropShadow
      .filter((s: any) => s.enabled !== false && s.present !== false)
      .map((s: any) => ({
        enabled: s.enabled !== false,
        blendMode: s.blendMode || 'multiply',
        color: colorToString(s.color),
        opacity: s.opacity != null ? s.opacity : 0.75,
        angle: s.angle != null ? s.angle : 120,
        distance: getUnitsPixelValue(s.distance),
        size: getUnitsPixelValue(s.size),
        spread: getUnitsPixelValue(s.choke), // spread 对应的是 choke/Spread
        useGlobalLight: s.useGlobalLight || false,
      }))
    if (style.dropShadow.length === 0) delete style.dropShadow
  }

  // 内阴影
  if (effects.innerShadow && effects.innerShadow.length > 0) {
    style.innerShadow = effects.innerShadow
      .filter((s: any) => s.enabled !== false && s.present !== false)
      .map((s: any) => ({
        enabled: s.enabled !== false,
        blendMode: s.blendMode || 'multiply',
        color: colorToString(s.color),
        opacity: s.opacity != null ? s.opacity : 0.75,
        angle: s.angle != null ? s.angle : 120,
        distance: getUnitsPixelValue(s.distance),
        size: getUnitsPixelValue(s.size),
        choke: getUnitsPixelValue(s.choke),
        useGlobalLight: s.useGlobalLight || false,
      }))
    if (style.innerShadow.length === 0) delete style.innerShadow
  }

  // 外发光
  if (effects.outerGlow && effects.outerGlow.enabled !== false && effects.outerGlow.present !== false) {
    const g = effects.outerGlow
    style.outerGlow = {
      enabled: g.enabled !== false,
      blendMode: g.blendMode || 'screen',
      color: colorToString(g.color),
      opacity: g.opacity != null ? g.opacity : 0.75,
      size: getUnitsPixelValue(g.size),
      spread: getUnitsPixelValue(g.choke),
    }
  }

  // 内发光
  if (effects.innerGlow && effects.innerGlow.enabled !== false && effects.innerGlow.present !== false) {
    const g = effects.innerGlow
    style.innerGlow = {
      enabled: g.enabled !== false,
      blendMode: g.blendMode || 'screen',
      color: colorToString(g.color),
      opacity: g.opacity != null ? g.opacity : 0.75,
      size: getUnitsPixelValue(g.size),
      choke: getUnitsPixelValue(g.choke),
      source: g.source || 'edge',
    }
  }

  // 颜色叠加（solidFill）
  if (effects.solidFill && effects.solidFill.length > 0) {
    style.colorOverlay = effects.solidFill
      .filter((s: any) => s.enabled !== false && s.present !== false)
      .map((s: any) => ({
        enabled: s.enabled !== false,
        blendMode: s.blendMode || 'normal',
        color: colorToString(s.color),
        opacity: s.opacity != null ? s.opacity : 1,
      }))
    if (style.colorOverlay.length === 0) delete style.colorOverlay
  }

  // 渐变叠加
  if (effects.gradientOverlay && effects.gradientOverlay.length > 0) {
    style.gradientOverlay = effects.gradientOverlay
      .filter((g: any) => g.enabled !== false && g.present !== false)
      .map((g: any) => {
        const grad = g.gradient || {}
        const colorStops = grad.colorStops || []
        const opacityStops = grad.opacityStops || []
        // 合并 colorStops 和 opacityStops
        const stops = colorStops.map((cs: any, i: number) => ({
          color: colorToString(cs.color),
          location: cs.location || 0,
          opacity: opacityStops[i]?.opacity != null ? opacityStops[i].opacity : 1,
        }))
        return {
          enabled: g.enabled !== false,
          blendMode: g.blendMode || 'normal',
          opacity: g.opacity != null ? g.opacity : 1,
          angle: g.angle != null ? g.angle : 90,
          scale: g.scale != null ? g.scale : 100,
          style: g.type || 'linear',
          gradientType: grad.type || 'solid',
          colorStops: stops,
        }
      })
    if (style.gradientOverlay.length === 0) delete style.gradientOverlay
  }

  // 描边
  if (effects.stroke && effects.stroke.length > 0) {
    style.stroke = effects.stroke
      .filter((s: any) => s.enabled !== false && s.present !== false)
      .map((s: any) => ({
        enabled: s.enabled !== false,
        blendMode: s.blendMode || 'normal',
        color: colorToString(s.color),
        opacity: s.opacity != null ? s.opacity : 1,
        size: getUnitsPixelValue(s.size),
        position: s.position || 'outside',
        fillType: s.fillType || 'color',
      }))
    if (style.stroke.length === 0) delete style.stroke
  }

  // 斜面浮雕
  if (effects.bevel && effects.bevel.enabled !== false && effects.bevel.present !== false) {
    const b = effects.bevel
    style.bevel = {
      enabled: b.enabled !== false,
      style: b.style || 'outer bevel',
      technique: b.technique || 'smooth',
      depth: b.strength != null ? b.strength : 100,
      direction: b.direction || 'up',
      size: getUnitsPixelValue(b.size),
      soften: getUnitsPixelValue(b.soften),
      angle: b.angle != null ? b.angle : 120,
      useGlobalLight: b.useGlobalLight || false,
      altitude: b.altitude != null ? b.altitude : 30,
      highlightBlendMode: b.highlightBlendMode || 'screen',
      shadowBlendMode: b.shadowBlendMode || 'multiply',
      highlightColor: colorToString(b.highlightColor),
      shadowColor: colorToString(b.shadowColor),
      highlightOpacity: b.highlightOpacity != null ? b.highlightOpacity : 0.75,
      shadowOpacity: b.shadowOpacity != null ? b.shadowOpacity : 0.75,
    }
  }

  // 光泽
  if (effects.satin && effects.satin.enabled !== false && effects.satin.present !== false) {
    const s = effects.satin
    style.satin = {
      enabled: s.enabled !== false,
      blendMode: s.blendMode || 'multiply',
      color: colorToString(s.color),
      opacity: s.opacity != null ? s.opacity : 0.5,
      angle: s.angle != null ? s.angle : 19,
      distance: getUnitsPixelValue(s.distance),
      size: getUnitsPixelValue(s.size),
      invert: s.invert || false,
    }
  }

  // 图案叠加
  if (effects.patternOverlay && effects.patternOverlay.enabled !== false && effects.patternOverlay.present !== false) {
    const p = effects.patternOverlay
    style.patternOverlay = {
      enabled: p.enabled !== false,
      blendMode: p.blendMode || 'normal',
      opacity: p.opacity != null ? p.opacity : 1,
      scale: p.scale != null ? p.scale : 100,
      patternName: p.pattern?.name || '',
    }
  }

  if (Object.keys(style).length === 0) return undefined
  return style
}
