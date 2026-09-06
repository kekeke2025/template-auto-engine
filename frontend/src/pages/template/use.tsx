import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  Upload,
  Button,
  Space,
  Row,
  Col,
  Image,
  Checkbox,
  message,
  Spin,
} from 'antd'
import {
  UploadOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
  InboxOutlined
} from '@ant-design/icons'
import request from '../../utils/request'
import { getImageUrl } from '../../utils/imageUrl'
import { flattenLayers } from '../../utils/psdParser'

// 从图层名提取匹配用的关键名称（去掉组名、尺寸等前缀，取最后一段）
function getLayerMatchName(layer: { name: string }): string {
  const parts = layer.name.split(/\/|\\/).map(s => s.trim())
  return parts[parts.length - 1] || layer.name
}

// 图层表单key：type:匹配名
function getLayerFormKey(layer: { name: string; type: string }): string {
  return `${layer.type}:${getLayerMatchName(layer)}`
}
import './use.module.css'

interface TextStyle {
  fontFamily?: string
  fontSize?: number
  color?: string
  fontWeight?: string | number
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: number
}

interface Layer {
  id: string
  name: string
  type: 'text' | 'image'
  textContent?: string
  textStyle?: TextStyle
  imageUrl?: string
  x?: number
  y?: number
  width?: number
  height?: number
  editable?: boolean
}

interface TemplateSize {
  name: string
  width: number
  height: number
}

interface SizeVariant extends TemplateSize {
  psdUrl: string
  cover: string
  layers: Layer[]
}

interface GeneratedImage {
  sizeName: string
  width: number
  height: number
  url: string
  fileSize?: number
}

interface Template {
  id: number
  name: string
  cover: string
  width: number
  height: number
  layers: Layer[]
  sizes: TemplateSize[]
  sizeVariants: SizeVariant[]
}

export default function TemplateUse() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [template, setTemplate] = useState<Template | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [zipUrl, setZipUrl] = useState('')
  const [selectedSizes, setSelectedSizes] = useState<string[]>([])
  const [editableLayers, setEditableLayers] = useState<Layer[]>([])
  const [hasSizeVariants, setHasSizeVariants] = useState(false)

  useEffect(() => {
    loadTemplateDetail()
  }, [id])

  const loadTemplateDetail = async () => {
    setLoading(true)
    try {
      const data: any = await request.get(`/template/${id}`)

      const sizeVariants = data.sizeVariants || []
      const hasVariants = sizeVariants.length > 0

      let editable: Layer[] = []
      let cover = getImageUrl(data.cover)
      let width = data.width || 0
      let height = data.height || 0

      if (hasVariants) {
        // 多尺寸变体模式：从第一个变体取可编辑图层（所有变体的可编辑图层是一致的）
        const firstVariant = sizeVariants[0]
        // 先扁平化（图层可能嵌套在组里），再过滤出 editable=true 的文字/图片层
        const flat = flattenLayers(firstVariant.layers || [])
        editable = flat.filter(
          (l: Layer) => l.editable && (l.type === 'text' || l.type === 'image')
        )
        cover = firstVariant.cover ? getImageUrl(firstVariant.cover) : cover
        width = firstVariant.width || width
        height = firstVariant.height || height
      } else {
        // 旧模板兼容：从 layers 里过滤
        const flat = flattenLayers(data.layers || [])
        editable = flat.filter(
          (l: any) => l.type === 'text' || l.type === 'image'
        )
      }

      const templateData: Template = {
        id: data.id,
        name: data.name,
        cover,
        width,
        height,
        layers: data.layers || [],
        sizes: data.sizes || [],
        sizeVariants,
      }

      setTemplate(templateData)
      setHasSizeVariants(hasVariants)
      setEditableLayers(editable)

      // 计算尺寸列表，默认全选
      const sizeList = hasVariants
        ? sizeVariants.map((v: SizeVariant) => v.name)
        : (data.sizes || []).map((s: TemplateSize) => s.name)

      if (sizeList.length > 0) {
        setSelectedSizes(sizeList)
      }

      // 初始化表单默认值（表单的 key 是图层匹配名（多尺寸模式）或 layerId（旧模式））
      const formValues: Record<string, any> = {}
      editable.forEach((layer: Layer) => {
        const key = hasVariants ? getLayerMatchName(layer) : layer.id
        formValues[key] = layer.textContent || layer.imageUrl || ''
      })
      form.setFieldsValue(formValues)
    } catch (e) {
      message.error('加载模板详情失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (template) {
      const totalSizes = hasSizeVariants
        ? template.sizeVariants.length
        : template.sizes.length
      if (totalSizes > 0 && selectedSizes.length === 0) {
        message.error('请至少选择一个尺寸')
        return
      }
    }

    const values = await form.validateFields()
    setGenerating(true)
    try {
      // 构建替换数据
      // 多尺寸变体模式：key 是图层匹配名（去掉组名/尺寸前缀后的最后一段）
      // 旧模式：key 是 layerId
      const replaceData: Record<string, any> = {}

      editableLayers.forEach((layer: Layer) => {
        const key = hasSizeVariants ? getLayerMatchName(layer) : layer.id
        const value = values[key]

        if (layer.type === 'text') {
          const originalText = layer.textContent || ''
          const currentText = value || ''
          if (originalText !== currentText) {
            const style = layer.textStyle || {}
            replaceData[key] = {
              type: 'text',
              content: currentText,
              style: {
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                color: style.color,
                fontWeight: style.fontWeight,
                textAlign: style.textAlign,
                lineHeight: style.lineHeight,
                letterSpacing: style.letterSpacing,
              },
            }
          }
        } else {
          replaceData[key] = { type: 'image', url: value }
        }
      })

      const result: any = await request.post(`/template/${id}/generate`, {
        replaceData,
        sizeNames: selectedSizes,
      })

      if (result.images && result.images.length > 0) {
        const images = result.images.map((img: any) => ({
          sizeName: img.sizeName,
          width: img.width,
          height: img.height,
          url: getImageUrl(img.url),
          fileSize: img.fileSize,
        }))
        setGeneratedImages(images)
        setZipUrl(result.zipUrl ? getImageUrl(result.zipUrl) : '')
      }
      message.success(`生成成功，共 ${result.images?.length || 0} 张图片`)
    } catch (e: any) {
      message.error(e?.response?.data?.message || '生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  const handleCustomImageUpload = async (options: any) => {
    const { file, onSuccess, onError } = options
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res: any = await request.post('/template/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onSuccess(res)
    } catch (e) {
      onError(e)
    }
  }

  const handleCheckAll = (e: any) => {
    if (!template) return
    const allSizes = hasSizeVariants
      ? template.sizeVariants.map(v => v.name)
      : template.sizes.map(s => s.name)
    if (e.target.checked) {
      setSelectedSizes(allSizes)
    } else {
      setSelectedSizes([])
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
  }

  if (loading) {
    return <div className="loading-container"><Spin size="large" /></div>
  }

  if (!template) {
    return <div className="error-container">模板不存在</div>
  }

  const sizeList = hasSizeVariants ? template.sizeVariants : template.sizes
  const hasSizes = sizeList.length > 0

  return (
    <div className="template-use-page">
      <div className="page-header">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate('/template/list')}
        >
          返回模板列表
        </Button>
        <h1>使用模板：{template.name}</h1>
      </div>

      <Row gutter={24}>
        <Col span={10}>
          <Card title="模板预览" className="preview-card">
            {template.cover ? (
              <Image
                src={template.cover}
                alt={template.name}
                style={{ width: '100%', borderRadius: 8 }}
                fallback="data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect fill='%23f0f0f0' width='400' height='300'/%3E%3Ctext fill='%23999' font-family='sans-serif' font-size='16' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3E暂无预览图%3C/text%3E%3C/svg%3E"
              />
            ) : (
              <div style={{ width: '100%', height: 200, background: '#f0f0f0', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                暂无预览图
              </div>
            )}
            <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
              {hasSizeVariants ? '多尺寸模板' : '原始尺寸'}：{template.width} × {template.height} px
            </div>
          </Card>

          {generatedImages.length > 0 && (
            <Card
              title={
                <Space>
                  <span>生成结果（{generatedImages.length}张）</span>
                  {zipUrl && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => window.open(zipUrl, '_blank')}
                    >
                      打包下载ZIP
                    </Button>
                  )}
                </Space>
              }
              className="result-card"
              style={{ marginTop: 24 }}
            >
              <Row gutter={[12, 12]}>
                {generatedImages.map((img, idx) => (
                  <Col span={12} key={idx}>
                    <div className="result-item">
                      <Image
                        src={img.url}
                        alt={img.sizeName}
                        style={{ width: '100%', borderRadius: 6, border: '1px solid #eee' }}
                      />
                      <div className="result-info">
                        <div className="result-name">{img.sizeName}</div>
                        <div className="result-size">
                          {img.width}×{img.height}
                          {img.fileSize && <span> · {formatFileSize(img.fileSize)}</span>}
                        </div>
                        <Button
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() => window.open(img.url, '_blank')}
                        >
                          下载
                        </Button>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            </Card>
          )}
        </Col>

        <Col span={14}>
          {hasSizes && (
            <Card title="选择尺寸" className="size-select-card" style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 12 }}>
                <Checkbox
                  indeterminate={selectedSizes.length > 0 && selectedSizes.length < sizeList.length}
                  checked={selectedSizes.length === sizeList.length}
                  onChange={handleCheckAll}
                >
                  全选
                </Checkbox>
              </div>
              <Checkbox.Group
                value={selectedSizes}
                onChange={vals => setSelectedSizes(vals as string[])}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}
              >
                {sizeList.map(size => (
                  <Checkbox key={size.name} value={size.name}>
                    {size.name}（{size.width}×{size.height}）
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Card>
          )}

          <Card title="编辑内容" className="edit-card">
            <Form form={form} layout="vertical">
              {editableLayers.map(layer => {
                const fieldKey = hasSizeVariants ? getLayerMatchName(layer) : layer.id
                return (
                  <Form.Item
                    key={fieldKey}
                    name={fieldKey}
                    label={layer.name}
                    rules={layer.type === 'text' ? [{ required: true, message: `请填写${layer.name}` }] : []}
                    getValueFromEvent={(e: any) => {
                      if (e?.fileList) {
                        const file = e.fileList[0]
                        if (file?.response?.url) {
                          return getImageUrl(file.response.url)
                        }
                        return file?.url || ''
                      }
                      return e?.target?.value
                    }}
                  >
                    {layer.type === 'text' ? (
                      <Input.TextArea
                        placeholder={`请输入${layer.name}`}
                        rows={2}
                      />
                    ) : (
                      <Upload
                        customRequest={handleCustomImageUpload}
                        listType="picture"
                        maxCount={1}
                        showUploadList={{ showPreviewIcon: false }}
                      >
                        <Button icon={<UploadOutlined />}>点击上传图片</Button>
                      </Upload>
                    )}
                  </Form.Item>
                )
              })}

              <Form.Item>
                <Space>
                  <Button
                    type="primary"
                    size="large"
                    loading={generating}
                    onClick={handleGenerate}
                  >
                    生成图片{selectedSizes.length > 1 ? `（${selectedSizes.length}张）` : ''}
                  </Button>
                  <Button size="large" onClick={() => form.resetFields()}>
                    重置内容
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
