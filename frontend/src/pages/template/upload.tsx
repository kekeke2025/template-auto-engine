import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Form,
  Input,
  InputNumber,
  Upload,
  Button,
  Space,
  Row,
  Col,
  Checkbox,
  List,
  Tag,
  Divider,
  message,
  Spin,
  Popconfirm,
  Image
} from 'antd'
import {
  UploadOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined
} from '@ant-design/icons'
import type { UploadProps } from 'antd'
import request from '../../utils/request'
import { parsePsdFile, flattenLayers, ParsedLayer } from '../../utils/psdParser'
import './upload.module.css'

interface Layer extends ParsedLayer {
  editable: boolean
}

interface SizeVariant {
  name: string
  width: number
  height: number
  psdFile: File
  psdUrl: string
  cover: string
  layers: Layer[]
  parsing: boolean
  parseSuccess: boolean
}

// 从图层名提取匹配用的关键名称（去掉组名、尺寸等前缀，取最后一段）
// 例："800x438 / 背景图" → "背景图"
// 例："组名/子组/主标题" → "主标题"
// 例："主标题" → "主标题"
function getLayerMatchName(layer: { name: string }): string {
  const parts = layer.name.split(/\/|\\/).map(s => s.trim())
  return parts[parts.length - 1] || layer.name
}

// 从图层名计算一个"合并key"，用于跨尺寸匹配同一图层
function getLayerKey(layer: { name: string; type: string }): string {
  return `${layer.type}:${getLayerMatchName(layer)}`
}

export default function TemplateUpload() {
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [variants, setVariants] = useState<SizeVariant[]>([])
  const [commonEditableLayers, setCommonEditableLayers] = useState<
    Array<{ key: string; name: string; type: string; editable: boolean }>
  >([])
  const [coverUrl, setCoverUrl] = useState('')

  // 处理多文件上传
  const handleBeforeUpload = (file: File, fileList: File[]) => {
    if (!file.name.toLowerCase().endsWith('.psd')) {
      message.error(`${file.name} 不是PSD格式文件`)
      return false
    }
    if (file.size > 100 * 1024 * 1024) {
      message.error(`${file.name} 超过100MB`)
      return false
    }

    // 检查是否已添加同名文件
    const fileName = file.name.replace(/\.psd$/i, '')
    if (variants.some(v => v.name === fileName || v.psdFile.name === file.name)) {
      message.warning(`${file.name} 已添加`)
      return false
    }

    // 解析这个PSD
    parseSinglePsd(file)
    return false // 阻止自动上传
  }

  // 解析单个PSD文件
  const parseSinglePsd = async (file: File) => {
    const defaultName = file.name.replace(/\.psd$/i, '')

    // 先添加一个占位
    const tempVariant: SizeVariant = {
      name: defaultName,
      width: 0,
      height: 0,
      psdFile: file,
      psdUrl: '',
      cover: '',
      layers: [],
      parsing: true,
      parseSuccess: false,
    }
    setVariants(prev => [...prev, tempVariant])

    try {
      const result = await parsePsdFile(file)

      const flatLayers = flattenLayers(result.layers).map(layer => ({
        ...layer,
        editable: layer.type === 'text' || layer.type === 'image',
      })) as Layer[]

      // 上传PSD文件到后端
      const psdUrl = await uploadPsdFile(file)

      // 上传预览图
      let cover = ''
      if (result.previewUrl) {
        cover = await uploadPreviewImage(result.previewUrl)
        if (!coverUrl) {
          setCoverUrl(cover) // 第一个的封面作为模板封面
        }
      }

      // 更新这个variant
      setVariants(prev => prev.map(v =>
        v.psdFile.name === file.name
          ? {
              ...v,
              width: result.width,
              height: result.height,
              psdUrl,
              cover,
              layers: flatLayers,
              parsing: false,
              parseSuccess: true,
            }
          : v
      ))

      message.success(`${file.name} 解析成功，共 ${flatLayers.length} 个图层`)

      // 重新计算公共可编辑图层（用当前已解析成功的 + 新的这个）
      const currentSuccess = variants.filter(v => v.parseSuccess).map(v => ({
        name: v.name,
        layers: v.layers,
      }))
      updateCommonEditableLayers([...currentSuccess, { name: defaultName, layers: flatLayers }])

    } catch (e: any) {
      message.error(`${file.name} 解析失败：${e?.message || '未知错误'}`)
      setVariants(prev => prev.filter(v => v.psdFile.name !== file.name))
    }
  }

  // 计算所有尺寸共有的可编辑图层（交集）
  const updateCommonEditableLayers = (
    newList?: Array<{ name: string; layers: Layer[] }>
  ) => {
    const allVariants = newList || variants.filter(v => v.parseSuccess).map(v => ({
      name: v.name,
      layers: v.layers,
    }))

    if (allVariants.length === 0) {
      setCommonEditableLayers([])
      return
    }

    // 取第一个的可编辑图层作为基准
    const firstVariant = allVariants[0]
    const editableKeys = new Map<string, { name: string; type: string }>()

    firstVariant.layers
      .filter(l => l.editable)
      .forEach(l => {
        const key = getLayerKey(l)
        editableKeys.set(key, { name: l.name, type: l.type })
      })

    // 和其他变体取交集
    for (let i = 1; i < allVariants.length; i++) {
      const variantKeys = new Set(
        allVariants[i].layers
          .filter(l => l.editable)
          .map(l => getLayerKey(l))
      )
      for (const key of editableKeys.keys()) {
        if (!variantKeys.has(key)) {
          editableKeys.delete(key)
        }
      }
    }

    const result = Array.from(editableKeys.entries()).map(([key, info]) => ({
      key,
      name: info.name,
      type: info.type,
      editable: true, // 默认全部可编辑
    }))

    setCommonEditableLayers(result)
  }

  const uploadPsdFile = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    const res: any = await request.post('/template/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.psdUrl
  }

  const uploadPreviewImage = async (base64Url: string): Promise<string> => {
    try {
      const res = await fetch(base64Url)
      const blob = await res.blob()
      const file = new File([blob], 'preview.png', { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', file)
      const result: any = await request.post('/template/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return result.url
    } catch (e) {
      console.warn('预览图上传失败', e)
      return ''
    }
  }

  // 修改尺寸名称
  const handleRenameVariant = (index: number, newName: string) => {
    if (!newName.trim()) return
    const newVariants = [...variants]
    newVariants[index] = { ...newVariants[index], name: newName.trim() }
    setVariants(newVariants)
  }

  // 删除尺寸
  const handleRemoveVariant = (index: number) => {
    const newVariants = variants.filter((_, i) => i !== index)
    setVariants(newVariants)
    // 重新计算公共图层
    if (newVariants.filter(v => v.parseSuccess).length > 0) {
      updateCommonEditableLayers(newVariants.filter(v => v.parseSuccess).map(v => ({
        name: v.name,
        layers: v.layers,
      })))
    } else {
      setCommonEditableLayers([])
    }
  }

  // 切换图层可编辑
  const handleToggleEditable = (key: string, checked: boolean) => {
    setCommonEditableLayers(prev =>
      prev.map(l => (l.key === key ? { ...l, editable: checked } : l))
    )
  }

  const handleSave = async () => {
    const values = await form.validateFields()

    if (variants.length === 0) {
      message.error('请至少上传一个PSD文件')
      return
    }

    const successVariants = variants.filter(v => v.parseSuccess)
    if (successVariants.length === 0) {
      message.error('没有解析成功的PSD文件')
      return
    }

    // 检查是否还有在解析中的
    if (variants.some(v => v.parsing)) {
      message.warning('还有PSD正在解析中，请稍候')
      return
    }

    try {
      // 构建 sizeVariants 数据
      const sizeVariants = successVariants.map(v => ({
        name: v.name,
        width: v.width,
        height: v.height,
        psdUrl: v.psdUrl,
        cover: v.cover,
        layers: v.layers.map(l => ({
          id: l.id,
          name: l.name,
          type: l.type,
          visible: l.visible,
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
          opacity: l.opacity,
          blendMode: l.blendMode,
          layerStyle: l.layerStyle,
          textContent: l.textContent,
          textStyle: l.textStyle,
          imageUrl: l.imageUrl,
          imageData: l.imageData,
          children: l.children,
          // 标记这个图层是否可编辑（根据公共图层列表）
          editable: commonEditableLayers.some(
            cl => cl.key === getLayerKey(l) && cl.editable
          ),
        })),
      }))

      await request.post('/template', {
        ...values,
        cover: coverUrl || values.cover,
        psdUrl: sizeVariants[0].psdUrl,
        layers: sizeVariants[0].layers, // 兼容旧字段，用第一个尺寸的
        width: sizeVariants[0].width,
        height: sizeVariants[0].height,
        sizes: sizeVariants.map(v => ({ name: v.name, width: v.width, height: v.height })),
        sizeVariants,
      })

      message.success('模板保存成功')
      navigate('/template/list')
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败，请重试')
    }
  }

  const uploadProps: UploadProps = {
    name: 'file',
    accept: '.psd',
    multiple: true,
    showUploadList: false,
    beforeUpload: handleBeforeUpload,
  }

  const editableCount = commonEditableLayers.filter(l => l.editable).length

  return (
    <div className="template-upload-page">
      <div className="page-header">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/template/list')}>
          返回模板列表
        </Button>
        <h1>上传PSD模板</h1>
      </div>

      <Row gutter={24}>
        <Col span={12}>
          <Card title="上传PSD" className="upload-card">
            <Upload.Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽多个PSD文件到这里上传</p>
              <p className="ant-upload-hint">
                支持同时上传多个尺寸的PSD，系统将自动识别为同一模板的不同尺寸
              </p>
            </Upload.Dragger>

            {variants.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  尺寸列表（{variants.length}）
                </div>
                <List
                  size="small"
                  dataSource={variants}
                  renderItem={(item, index) => (
                    <List.Item
                      actions={[
                        <Popconfirm
                          key="delete"
                          title="确定删除该尺寸？"
                          onConfirm={() => handleRemoveVariant(index)}
                        >
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                        </Popconfirm>
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          item.cover ? (
                            <Image
                              src={item.cover}
                              width={48}
                              height={48}
                              style={{ borderRadius: 4, objectFit: 'cover' }}
                              preview={false}
                            />
                          ) : (
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                background: '#f0f0f0',
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                color: '#999',
                              }}
                            >
                              PSD
                            </div>
                          )
                        }
                        title={
                          item.parsing ? (
                            <Space>
                              <Spin size="small" />
                              <span>{item.name}（解析中...）</span>
                            </Space>
                          ) : (
                            <Input
                              size="small"
                              value={item.name}
                              onChange={e => handleRenameVariant(index, e.target.value)}
                              style={{ width: 200 }}
                              prefix={<EditOutlined style={{ color: '#999' }} />}
                            />
                          )
                        }
                        description={
                          item.parseSuccess
                            ? `${item.width} × ${item.height} px · ${item.layers.length} 个图层`
                            : '解析失败'
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Card>

          <Card title="模板基本信息" className="info-card" style={{ marginTop: 24 }}>
            <Form form={form} layout="vertical">
              <Form.Item
                name="name"
                label="模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]}
              >
                <Input placeholder="请输入模板名称，如：公众号封面通用模板" />
              </Form.Item>

              <Form.Item name="category" label="模板分类">
                <Input placeholder="请输入分类，如：运营、新媒体、电商" />
              </Form.Item>

              <Form.Item name="cover" label="模板封面图">
                <Input placeholder="请输入封面图URL（自动取第一个PSD的预览图）" />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={12}>
          <Card
            title="可编辑图层配置"
            className="layers-card"
            extra={
              <span style={{ color: '#666' }}>
                勾选允许用户编辑的图层（{editableCount}/{commonEditableLayers.length}）
              </span>
            }
          >
            {variants.length === 0 ? (
              <div className="empty-tip">请先上传PSD文件，系统将自动识别图层</div>
            ) : variants.every(v => v.parsing) ? (
              <div className="empty-tip">
                <Spin />
                <span style={{ marginLeft: 8 }}>正在解析PSD文件...</span>
              </div>
            ) : commonEditableLayers.length === 0 ? (
              <div className="empty-tip">
                没有找到各尺寸共有的可编辑图层
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  请确保不同尺寸的PSD中，相同功能的图层使用相同的命名
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12, color: '#666', fontSize: 12 }}>
                  以下是 {variants.filter(v => v.parseSuccess).length} 个尺寸共有的可编辑图层（按图层名匹配）
                </div>
                <List
                  dataSource={commonEditableLayers}
                  renderItem={layer => (
                    <List.Item key={layer.key}>
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <span className="layer-name">
                          {layer.name}
                          <span className="layer-type">
                            （{layer.type === 'text' ? '文字层' : '图片层'}）
                          </span>
                        </span>
                        <Checkbox
                          checked={layer.editable}
                          onChange={e => handleToggleEditable(layer.key, e.target.checked)}
                        >
                          允许编辑
                        </Checkbox>
                      </div>
                    </List.Item>
                  )}
                />
              </>
            )}
          </Card>

          <div className="submit-section" style={{ marginTop: 24 }}>
            <Space>
              <Button type="primary" size="large" onClick={handleSave}>
                保存模板
              </Button>
              <Button size="large" onClick={() => navigate('/template/list')}>
                取消
              </Button>
            </Space>
          </div>
        </Col>
      </Row>
    </div>
  )
}
