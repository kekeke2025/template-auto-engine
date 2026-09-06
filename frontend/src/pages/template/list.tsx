import { useState, useEffect } from 'react'
import { Row, Col, Card, Button, Input, Select, Pagination, Empty, message, Tabs } from 'antd'
import { SearchOutlined, EyeOutlined, HeartOutlined, HeartFilled } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getTemplateList, getFavoriteList, favoriteTemplate, unfavoriteTemplate } from '../../api/template'
import { getImageUrl } from '../../utils/imageUrl'
import './list.css'

const { Search } = Input
const { Option } = Select

export default function TemplateList() {
  const [activeTab, setActiveTab] = useState('all')
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 8, total: 0 })
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<string | undefined>()
  const navigate = useNavigate()

  const fetchTemplates = async (page = 1, pageSize = 8) => {
    setLoading(true)
    try {
      const res: any = await getTemplateList({
        page,
        pageSize,
        keyword: keyword || undefined,
        category: category || undefined,
      })
      setTemplates(res.list || [])
      setPagination({ current: page, pageSize, total: res.total || 0 })
    } catch (e) {
      message.error('获取模板列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchFavorites = async (page = 1, pageSize = 8) => {
    setLoading(true)
    try {
      const res: any = await getFavoriteList({ page, pageSize })
      setTemplates(res.list || [])
      setPagination({ current: page, pageSize, total: res.total || 0 })
    } catch (e) {
      message.error('获取收藏列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'all') {
      fetchTemplates(pagination.current, pagination.pageSize)
    } else {
      fetchFavorites(pagination.current, pagination.pageSize)
    }
  }, [activeTab])

  const handleSearch = () => {
    if (activeTab === 'all') {
      fetchTemplates(1, pagination.pageSize)
    }
  }

  const handlePageChange = (page: number, pageSize: number) => {
    if (activeTab === 'all') {
      fetchTemplates(page, pageSize)
    } else {
      fetchFavorites(page, pageSize)
    }
  }

  const handleUseTemplate = (id: number) => {
    navigate(`/template/use/${id}`)
  }

  const handleFavorite = async (e: React.MouseEvent, id: number, isFavorited: boolean) => {
    e.stopPropagation()
    try {
      if (isFavorited) {
        await unfavoriteTemplate(id)
        message.success('取消收藏成功')
      } else {
        await favoriteTemplate(id)
        message.success('收藏成功')
      }
      // 刷新列表
      if (activeTab === 'all') {
        fetchTemplates(pagination.current, pagination.pageSize)
      } else {
        fetchFavorites(pagination.current, pagination.pageSize)
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败')
    }
  }

  const tabItems = [
    { key: 'all', label: '全部模板' },
    { key: 'favorite', label: '我的收藏' },
  ]

  return (
    <div className="template-list">
      <div className="list-header">
        <h1>模板列表</h1>
        <div className="header-actions">
          {activeTab === 'all' && (
            <>
              <Search
                placeholder="搜索模板名称"
                style={{ width: 300, marginRight: 16 }}
                prefix={<SearchOutlined />}
                allowClear
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onSearch={handleSearch}
              />
              <Select
                placeholder="分类筛选"
                style={{ width: 150, marginRight: 16 }}
                allowClear
                value={category}
                onChange={val => { setCategory(val); fetchTemplates(1, pagination.pageSize) }}
              >
                <Option value="运营">运营</Option>
                <Option value="设计">设计</Option>
                <Option value="新媒体">新媒体</Option>
                <Option value="电商">电商</Option>
              </Select>
            </>
          )}
          <Button type="primary" onClick={() => navigate('/template/upload')}>
            上传新模板
          </Button>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        style={{ marginBottom: 16 }}
      />

      {templates.length > 0 ? (
        <>
          <Row gutter={[24, 24]}>
            {templates.map((item: any) => (
              <Col span={6} key={item.id}>
                <Card
                  hoverable
                  loading={loading}
                  cover={
                    <div style={{ position: 'relative' }}>
                      <img
                        alt={item.name}
                        src={getImageUrl(item.cover)}
                        style={{ height: 200, objectFit: 'cover', width: '100%', background: '#f0f0f0' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                      <Button
                        type="text"
                        icon={activeTab === 'favorite' ? <HeartFilled style={{ color: '#ff4d4f' }} /> : <HeartOutlined />}
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          background: 'rgba(255,255,255,0.9)',
                          borderRadius: '50%',
                          width: 32,
                          height: 32,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onClick={e => handleFavorite(e, item.id, activeTab === 'favorite')}
                      />
                    </div>
                  }
                  actions={[
                    <Button type="primary" onClick={() => handleUseTemplate(item.id)} icon={<EyeOutlined />} block>
                      使用模板
                    </Button>
                  ]}
                >
                  <Card.Meta
                    title={item.name}
                    description={
                      <div style={{ marginTop: 8 }}>
                        <div>分类：{item.category || '未分类'}</div>
                        <div>
                          {item.sizeVariants && item.sizeVariants.length > 0
                            ? `${item.sizeVariants.length} 个尺寸`
                            : `尺寸：${item.width} × ${item.height} px`}
                        </div>
                        <div>创建时间：{item.createTime?.split('T')[0]}</div>
                      </div>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>

          <div style={{ marginTop: 32, textAlign: 'center' }}>
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              onChange={handlePageChange}
            />
          </div>
        </>
      ) : (
        <Empty
          description={activeTab === 'favorite' ? '暂无收藏的模板' : '暂无模板，快去上传第一个模板吧！'}
          style={{ marginTop: 100 }}
        >
          <Button type="primary" onClick={() => navigate('/template/upload')}>
            上传模板
          </Button>
        </Empty>
      )}
    </div>
  )
}
