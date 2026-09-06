# MCP插件接入指南与对接方案

## 一、需要对接的MCP插件清单
| 插件名称 | 优先级 | 功能描述 | 对接位置 |
| --- | --- | --- | --- |
| PSD解析插件 | 高 | 解析PSD文件，提取图层结构、文字样式、图片资源、位置尺寸等信息 | 后端服务，PSD模板上传后调用 |
| 图片批量渲染插件 | 高 | 根据模板图层配置和替换内容，批量渲染生成指定尺寸的高清图片 | 后端服务，用户提交生成请求时调用 |
| 字体管理插件 | 中 | 自动识别PSD中的字体，匹配系统字体库，检查商业字体授权 | 后端服务，PSD解析完成后调用 |
| 图片优化插件 | 中 | 自动压缩图片、转换格式、添加水印，优化文件大小 | 后端服务，图片渲染完成后调用 |

---

## 二、核心插件详细对接方案
### 2.1 PSD解析插件
#### 功能说明
输入PSD文件地址，输出解析后的完整图层结构，自动区分文字层、图片层、普通装饰层，提取所有可编辑属性。

#### 接口信息
- **接口地址：** `https://mcp.example.com/psd/parse`
- **请求方式：** POST
- **请求格式：** JSON

#### 请求参数
```json
{
  "psd_url": "https://xxx.oss-cn-beijing.aliyuncs.com/template/xxx.psd",
  "options": {
    "extract_text_style": true, // 是否提取文字样式（字体、大小、颜色等）
    "extract_image_resource": true, // 是否提取图片层资源
    "flatten_hidden_layer": true // 是否扁平化隐藏图层
  }
}
```

#### 响应参数
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "width": 1080, // PSD文件宽度
    "height": 1920, // PSD文件高度
    "dpi": 72,
    "layers": [
      {
        "id": "layer_001",
        "name": "标题文字",
        "type": "text", // 图层类型：text/image/shape
        "visible": true,
        "x": 100, // 位置x
        "y": 200, // 位置y
        "width": 800, // 图层宽度
        "height": 100, // 图层高度
        "opacity": 1, // 透明度
        "text_content": "默认标题内容", // 文字内容
        "text_style": { // 文字样式
          "font_family": "PingFang SC",
          "font_size": 48,
          "color": "#333333",
          "font_weight": "bold",
          "text_align": "left",
          "line_height": 1.5
        }
      },
      {
        "id": "layer_002",
        "name": "封面图",
        "type": "image",
        "visible": true,
        "x": 0,
        "y": 0,
        "width": 1080,
        "height": 800,
        "opacity": 1,
        "image_url": "https://xxx.oss-cn-beijing.aliyuncs.com/extract/xxx.png" // 提取的图片资源地址
      }
    ]
  }
}
```

#### 对接流程
1. 用户上传PSD文件到对象存储，得到文件URL
2. 后端调用PSD解析插件接口，传入PSD地址
3. 解析成功后，存储图层元数据到数据库
4. 前端展示解析出的可编辑图层，供用户配置

---

### 2.2 图片批量渲染插件
#### 功能说明
输入模板图层配置、替换内容、目标尺寸列表，批量渲染生成所有尺寸的图片。

#### 接口信息
- **接口地址：** `https://mcp.example.com/image/render-batch`
- **请求方式：** POST
- **请求格式：** JSON

#### 请求参数
```json
{
  "template_config": {
    "base_layers": [...], // 模板基础图层配置（PSD解析返回的图层结构）
    "default_width": 1080,
    "default_height": 1920
  },
  "replace_content": { // 用户替换的内容
    "texts": [
      {
        "layer_id": "layer_001",
        "content": "新的标题内容",
        "style": {} // 可选，自定义样式，不传用默认
      }
    ],
    "images": [
      {
        "layer_id": "layer_002",
        "url": "https://xxx.oss-cn-beijing.aliyuncs.com/user/xxx.jpg"
      }
    ]
  },
  "target_sizes": [ // 需要生成的尺寸列表
    {
      "name": "公众号封面",
      "width": 900,
      "height": 383,
      "fit_strategy": "contain" // 适配策略：contain覆盖/cover裁剪
    },
    {
      "name": "小红书封面",
      "width": 1080,
      "height": 1920,
      "fit_strategy": "cover"
    }
  ],
  "options": {
    "format": "png", // 导出格式：png/jpg/webp
    "quality": 90, // 质量 0-100
    "output_dir": "render/xxx/" // 输出目录
  }
}
```

#### 响应参数
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "render_xxx_123",
    "status": "completed", // pending/completed/failed
    "results": [
      {
        "size_name": "公众号封面",
        "width": 900,
        "height": 383,
        "url": "https://xxx.oss-cn-beijing.aliyuncs.com/render/xxx/gzh.png",
        "file_size": 204800
      },
      {
        "size_name": "小红书封面",
        "width": 1080,
        "height": 1920,
        "url": "https://xxx.oss-cn-beijing.aliyuncs.com/render/xxx/xhs.png",
        "file_size": 512000
      }
    ]
  }
}
```

#### 对接流程
1. 用户提交生成请求，选择模板、输入替换内容
2. 后端组装请求参数，调用图片批量渲染插件
3. 支持异步回调：如果渲染时间较长，可通过回调通知渲染结果
4. 渲染完成后，保存生成的图片信息到用户生成记录
5. 前端展示预览图和下载链接

---

## 三、通用对接规范
### 3.1 鉴权方式
所有MCP接口请求都需要在Header中携带鉴权信息：
```http
X-MCP-AppId: your_app_id
X-MCP-Signature: request_signature
X-MCP-Timestamp: 1717255200
```

签名生成规则：
`signature = md5(appId + appSecret + timestamp + requestBody)`

### 3.2 错误处理
| 错误码 | 说明 | 处理方案 |
| --- | --- | --- |
| 400 | 参数错误 | 校验请求参数，提示用户重新上传/提交 |
| 401 | 鉴权失败 | 检查AppId和签名配置 |
| 429 | 请求超限 | 触发降级逻辑，提示用户稍后重试，同时进行限流控制 |
| 500 | 插件内部错误 | 重试2次，如果仍然失败，返回用户友好提示，记录错误日志 |
| 504 | 请求超时 | 异步任务处理，通过回调获取结果 |

### 3.3 限流与降级策略
- 单个接口QPS限制：根据购买的MCP配额配置限流规则
- 降级方案：MCP插件不可用时，自动切换到自研开源方案兜底
- 重试机制：失败请求自动重试2次，间隔1s
- 超时配置：PSD解析超时15s，图片渲染超时30s

---

## 四、接入步骤
### 第一步：申请插件权限
1. 注册MCP平台账号
2. 申请开通PSD解析插件、图片批量渲染插件权限
3. 获取AppId和AppSecret

### 第二步：开发环境对接
1. 配置MCP插件接口地址和鉴权信息到环境变量
2. 开发PSD解析接口调用逻辑，调试解析结果
3. 开发图片渲染接口调用逻辑，调试生成效果
4. 实现错误处理和重试机制

### 第三步：测试验证
1. 上传不同复杂度的PSD模板，验证解析准确性
2. 测试不同尺寸、不同内容的批量渲染效果
3. 测试并发请求，验证性能和稳定性
4. 测试错误场景，验证降级逻辑有效性

### 第四步：生产上线
1. 配置生产环境的AppId和AppSecret
2. 配置监控告警，实时监控插件调用成功率和响应时间
3. 灰度发布，逐步放量用户
4. 根据使用情况调整配额

---

## 五、示例代码（Node.js）
```typescript
import * as crypto from 'crypto';
import axios from 'axios';

// MCP配置
const MCP_CONFIG = {
  appId: process.env.MCP_APP_ID,
  appSecret: process.env.MCP_APP_SECRET,
  baseUrl: 'https://mcp.example.com'
};

// 生成签名
function generateSignature(timestamp: number, body: any): string {
  const signStr = `${MCP_CONFIG.appId}${MCP_CONFIG.appSecret}${timestamp}${JSON.stringify(body)}`;
  return crypto.createHash('md5').update(signStr).digest('hex');
}

// 调用PSD解析接口
export async function parsePsd(psdUrl: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    psd_url: psdUrl,
    options: {
      extract_text_style: true,
      extract_image_resource: true
    }
  };
  
  const signature = generateSignature(timestamp, body);
  
  try {
    const response = await axios.post(`${MCP_CONFIG.baseUrl}/psd/parse`, body, {
      headers: {
        'X-MCP-AppId': MCP_CONFIG.appId,
        'X-MCP-Signature': signature,
        'X-MCP-Timestamp': timestamp.toString()
      },
      timeout: 15000
    });
    
    return response.data;
  } catch (error) {
    console.error('PSD解析失败:', error);
    throw new Error('PSD解析失败，请重试');
  }
}
```

---

## 六、兜底方案
如果MCP插件出现故障，可以临时切换到自研方案：
1. PSD解析：基于开源`psd.js`库实现基础解析能力，支持标准图层解析
2. 图片渲染：基于`Sharp` + `node-canvas`实现基础渲染能力
3. 切换方式：通过配置开关一键切换，无需代码修改

```bash
# 配置开关示例
MCP_ENABLED=false # 关闭MCP插件，使用自研方案
```
