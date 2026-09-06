import { useState, useEffect } from 'react'
import { Card, List, Button, Tag, Empty, Pagination, message, Modal, Image } from 'antd'
import { DownloadOutlined, EyeOutlined } from '@ant-design/icons'
import { getRecordList } from '../../api/template'
import { getImageUrl } from '../../utils/imageUrl'
import './index.css'

export default function GenerateRecord() {
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 })
  const [previewVisible, setPreviewVisible] = useState(false)
  const [previewImages, setPreviewImages] = useState<any[]>([])

  const fetchRecords = async (page = 1, pageSize = 10) => {
    setLoading(true)
    try {
      const res: any = await getRecordList({ page, pageSize })
      setRecords(res.list || [])
      setPagination({ current: page, pageSize, total: res.total || 0 })
    } catch (e) {
      message.error('获取生成记录失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [])

  const handlePageChange = (page: number, pageSize: number) => {
    fetchRecords(page, pageSize)
  }

  const handlePreview = (record: any) => {
    const images = record.results?.map((r: any) => ({
      src: getImageUrl(r.url),
      title: r.sizeName,
    })) || []
    setPreviewImages(images)
    setPreviewVisible(true)
  }

  const handleDownload = (url: string) => {
    window.open(getImageUrl(url), '_blank')
  }

  const handleDownloadZip = (zipUrl: string) => {
    window.open(getImageUrl(zipUrl), '_blank')
  }

  return (
    <div className="generate-record-page">
      <div className="page-header">
        <h1>生成记录</h1>
      </div>

      {records.length > 0 ? (
        <>
          <List
            loading={loading}
            dataSource={records}
            renderItem={(item: any) => (
              <List.Item key={item.id}>
                <Card style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                        记录 #{item.id}
                        <Tag color={item.status === 1 ? 'green' : 'red'} style={{ marginLeft: 12 }}>
                          {item.status === 1 ? '成功' : '失败'}
                        </Tag>
                      </div>
                      <div style={{ color: '#666', marginBottom: 12 }}>
                        模板ID: {item.templateId} | 生成时间: {item.createTime?.replace('T', ' ').split('.')[0]}
                      </div>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {item.results?.map((r: any, idx: number) => (
                          <div key={idx} style={{ textAlign: 'center' }}>
                            <img
                              src={getImageUrl(r.url)}
                              alt={r.sizeName}
                              style={{
                                width: 120,
                                height: 80,
                                objectFit: 'cover',
                                borderRadius: 4,
                                border: '1px solid #eee',
                                cursor: 'pointer',
                              }}
                              onClick={() => handlePreview(item)}
                            />
                            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                              {r.sizeName}
                            </div>
                            <div style={{ fontSize: 12, color: '#999' }}>
                              {r.width}×{r.height}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Button
                        icon={<EyeOutlined />}
                        onClick={() => handlePreview(item)}
                      >
                        预览
                      </Button>
                      {item.zipUrl && (
                        <Button
                          type="primary"
                          icon={<DownloadOutlined />}
                          onClick={() => handleDownloadZip(item.zipUrl)}
                        >
                          打包下载
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />

          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={handlePageChange}
            />
          </div>
        </>
      ) : (
        <Empty description="暂无生成记录" style={{ marginTop: 100 }} />
      )}

      <Modal
        title="图片预览"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={800}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
          {previewImages.map((img, idx) => (
            <div key={idx} style={{ textAlign: 'center' }}>
              <Image
                src={img.src}
                alt={img.title}
                style={{ maxWidth: 350, maxHeight: 300, objectFit: 'contain' }}
              />
              <div style={{ marginTop: 8, color: '#666' }}>{img.title}</div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
