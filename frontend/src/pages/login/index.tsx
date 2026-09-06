import { useState } from 'react'
import { Form, Input, Button, Card, Tabs, message } from 'antd'
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useUserStore } from '../../stores/user'
import request from '../../utils/request'
import './index.css'

type TabType = 'login' | 'register'

export default function Login() {
  const [activeTab, setActiveTab] = useState<TabType>('login')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setToken, setUserInfo } = useUserStore()

  const onLogin = async (values: any) => {
    setLoading(true)
    try {
      const res = await request.post('/auth/login', values)
      setToken(res.token)
      setUserInfo(res.user)
      message.success('登录成功')
      navigate('/template/list')
    } finally {
      setLoading(false)
    }
  }

  const onRegister = async (values: any) => {
    setLoading(true)
    try {
      const res = await request.post('/auth/register', values)
      setToken(res.token)
      setUserInfo(res.user)
      message.success('注册成功')
      navigate('/template/list')
    } finally {
      setLoading(false)
    }
  }

  const loginForm = (
    <Form
      name="login"
      onFinish={onLogin}
      autoComplete="off"
      size="large"
    >
      <Form.Item
        name="email"
        rules={[
          { required: true, message: '请输入邮箱' },
          { type: 'email', message: '邮箱格式不正确' }
        ]}
      >
        <Input prefix={<MailOutlined />} placeholder="邮箱" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="密码" />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          登录
        </Button>
      </Form.Item>
    </Form>
  )

  const registerForm = (
    <Form
      name="register"
      onFinish={onRegister}
      autoComplete="off"
      size="large"
    >
      <Form.Item
        name="username"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: 2, message: '用户名长度不能少于2位' }
        ]}
      >
        <Input prefix={<UserOutlined />} placeholder="用户名" />
      </Form.Item>

      <Form.Item
        name="email"
        rules={[
          { required: true, message: '请输入邮箱' },
          { type: 'email', message: '邮箱格式不正确' }
        ]}
      >
        <Input prefix={<MailOutlined />} placeholder="邮箱" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 6, message: '密码长度不能少于6位' },
          { pattern: /^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]/, message: '密码必须包含字母和数字' }
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="密码" />
      </Form.Item>

      <Form.Item
        name="confirmPassword"
        rules={[
          { required: true, message: '请确认密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) {
                return Promise.resolve()
              }
              return Promise.reject(new Error('两次输入的密码不一致'))
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          注册
        </Button>
      </Form.Item>
    </Form>
  )

  const tabItems = [
    {
      key: 'login',
      label: '登录',
      children: loginForm,
    },
    {
      key: 'register',
      label: '注册',
      children: registerForm,
    },
  ]

  return (
    <div className="login-container">
      <Card className="login-card">
        <div className="login-header">
          <h1>PSD模板批量出图工具</h1>
          <p>一键生成多尺寸封面，提升运营效率</p>
        </div>
        <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as TabType)} items={tabItems} />
      </Card>
    </div>
  )
}
