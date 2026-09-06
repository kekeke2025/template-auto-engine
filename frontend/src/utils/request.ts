import axios from 'axios'
import { message } from 'antd'
import { useUserStore } from '../stores/user'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
  timeout: 30000,
})

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    const token = useUserStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    const { code, message: msg, data } = response.data
    if (code === 0 || code === 200) {
      return data
    }
    message.error(msg || '请求失败')
    return Promise.reject(new Error(msg || '请求失败'))
  },
  (error) => {
    if (error.response?.status === 401) {
      useUserStore.getState().logout()
      window.location.href = '/login'
      message.error('登录已过期，请重新登录')
    } else {
      message.error(error.response?.data?.message || error.message || '网络错误')
    }
    return Promise.reject(error)
  }
)

export default request
