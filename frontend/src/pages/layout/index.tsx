import { Layout, Menu, Avatar, Dropdown, Button } from 'antd'
import { FileTextOutlined, UploadOutlined, FileDoneOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useUserStore } from '../../stores/user'
import './index.css'

const { Sider, Header, Content } = Layout

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { userInfo, logout } = useUserStore()

  const menuItems = [
    {
      key: '/template/list',
      icon: <FileTextOutlined />,
      label: '模板列表',
      onClick: () => navigate('/template/list'),
    },
    {
      key: '/template/upload',
      icon: <UploadOutlined />,
      label: '上传模板',
      onClick: () => navigate('/template/upload'),
    },
    {
      key: '/record',
      icon: <FileDoneOutlined />,
      label: '我的记录',
      onClick: () => navigate('/record'),
    },
  ]

  const dropdownItems = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout()
        navigate('/login')
      },
    },
  ]

  return (
    <Layout className="main-layout">
      <Sider width={220} theme="light">
        <div className="logo">
          <h2>PSD出图工具</h2>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{ height: 'calc(100% - 64px)' }}
        />
      </Sider>
      <Layout>
        <Header className="header">
          <div className="header-right">
            <Dropdown menu={{ items: dropdownItems }}>
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} style={{ marginRight: 8 }} />
              <span>{userInfo?.username}</span>
            </div>
          </Dropdown>
          </div>
        </Header>
        <Content className="content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
