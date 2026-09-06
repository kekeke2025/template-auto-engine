import { readPsd } from 'ag-psd'

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
  }
  imageUrl?: string
  imageData?: string // base64 格式的图层图片（仅上传时使用，用于传给后端保存）
  children?: ParsedLayer[]
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
