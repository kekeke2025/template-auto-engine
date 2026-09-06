import request from '../utils/request';

/**
 * 用户注册
 */
export const register = (data: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}) => {
  return request.post('/auth/register', data);
};

/**
 * 用户登录
 */
export const login = (data: { email: string; password: string }) => {
  return request.post('/auth/login', data);
};

/**
 * 获取当前用户信息
 */
export const getProfile = () => {
  return request.get('/auth/profile');
};
