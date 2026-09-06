import request from '../utils/request'

// 获取模板列表
export function getTemplateList(params: {
  page?: number
  pageSize?: number
  category?: string
  keyword?: string
}) {
  return request.get('/template', { params })
}

// 获取模板详情
export function getTemplateDetail(id: number) {
  return request.get(`/template/${id}`)
}

// 创建模板
export function createTemplate(data: any) {
  return request.post('/template', data)
}

// 删除模板
export function deleteTemplate(id: number) {
  return request.delete(`/template/${id}`)
}

// 上传PSD并解析
export function uploadPsd(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return request.post('/template/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

// 解析PSD（兼容旧接口）
export function parsePsd(psdUrl: string) {
  return request.post('/template/parse', { psdUrl })
}

// 生成图片
export function generateImages(id: number, replaceData: any) {
  return request.post(`/template/${id}/generate`, { replaceData })
}

// 收藏模板
export function favoriteTemplate(id: number) {
  return request.post(`/template/${id}/favorite`)
}

// 取消收藏
export function unfavoriteTemplate(id: number) {
  return request.delete(`/template/${id}/favorite`)
}

// 检查是否已收藏
export function checkFavorite(id: number) {
  return request.get(`/template/${id}/favorite/check`)
}

// 获取收藏列表
export function getFavoriteList(params: {
  page?: number
  pageSize?: number
}) {
  return request.get('/template/favorite/list', { params })
}

// 获取生成记录列表
export function getRecordList(params: {
  page?: number
  pageSize?: number
}) {
  return request.get('/template/record/list', { params })
}

// 获取生成记录详情
export function getRecordDetail(id: number) {
  return request.get(`/template/record/${id}`)
}
