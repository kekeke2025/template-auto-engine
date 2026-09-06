/**
 * 获取完整的图片 URL
 * 如果是相对路径（/uploads/...），加上后端地址前缀
 * 如果是完整 URL（http://... 或 https://...），直接返回
 */
export function getImageUrl(url: string | undefined | null): string {
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url
  }
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
  // 去掉 /api 后缀，得到域名
  const origin = baseUrl.replace(/\/api\/?$/, '')
  return origin + url
}
