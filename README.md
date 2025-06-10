# 即梦AI图片生成 MCP 服务

基于火山引擎即梦AI的图片生成MCP（Model Context Protocol）服务。

## 功能特性

- 使用火山引擎即梦AI API生成高质量图片
- 支持多种图片比例：4:3、3:4、16:9、9:16
- 标准化的MCP接口，兼容各种MCP客户端
- 环境变量配置，安全便捷

## 安装依赖

```bash
cd jimengpic-mcp
npm install
```

## 编译项目

```bash
npm run build
```

## 环境变量配置

设置以下环境变量：

```bash
export JIMENG_ACCESS_KEY="你的火山引擎AccessKey"
export JIMENG_SECRET_KEY="你的火山引擎SecretKey"
```

### 获取API密钥

1. 访问 [火山引擎控制台](https://console.volcengine.com/)
2. 登录后进入"即梦AI"产品页面，开通服务（可选择免费试用）
3. 在"访问控制"页面创建访问密钥，获取Access Key和Secret Key
4. 确保账号已开通即梦AI图像生成相关权限和策略

**注意：** 根据官方文档，请确保使用正确的req_key参数值 `jimeng_high_aes_general_v21_L`

## 使用方法

### 直接运行

```bash
node build/index.js
```

### 作为MCP服务器

在MCP客户端（如Claude Desktop、Cursor等）中配置此服务：

```json
{
  "mcpServers": {
    "jimengpic": {
      "command": "node",
      "args": ["/path/to/jimengpic-mcp/build/index.js"],
      "env": {
        "JIMENG_ACCESS_KEY": "你的AccessKey",
        "JIMENG_SECRET_KEY": "你的SecretKey"
      }
    }
  }
}
```

## API接口

### generate-image

当用户需要生成图片时使用的工具。

**参数：**
- `text` (string): 用户需要在图片上显示的文字
- `illustration` (string): 根据用户要显示的文字，提取3-5个可以作为图片配饰的插画元素关键词
- `color` (string): 图片的背景主色调
- `ratio` (enum): 图片比例，支持以下选项：
  - `"4:3"`: 512×384
  - `"3:4"`: 384×512  
  - `"16:9"`: 512×288
  - `"9:16"`: 288×512

**提示词生成规则：**
工具会自动将输入参数组合成以下格式的提示词：
```
字体设计："{text}"，黑色字体，斜体，带阴影。干净的背景，白色到{color}渐变。点缀浅灰色、半透明{illustration}等元素插图做配饰插画。
```

**返回：**
- 成功时返回图片URL和详细信息
- 失败时返回错误信息

## 使用示例

```typescript
// 在MCP客户端中调用
const result = await mcp.callTool("generate-image", {
  text: "新年快乐",
  illustration: "烟花, 灯笼, 祥云, 星星, 礼花",
  color: "红色",
  ratio: "4:3"
});
```

## 项目结构

```
jimengpic-mcp/
├── src/
│   └── index.ts          # 主服务文件
├── build/                # 编译输出目录
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript配置
└── README.md            # 项目说明
```

## 注意事项

1. 确保网络连接正常，能够访问火山引擎API
2. API调用需要消耗积分，请注意使用量
3. 生成的图片URL有时效性，建议及时下载保存
4. 请遵守火山引擎的使用条款和即梦AI的内容政策

## 故障排除

### 常见错误

1. **环境变量未设置**：确保设置了正确的ACCESS_KEY和SECRET_KEY
2. **网络连接问题**：检查网络连接和防火墙设置
3. **API配额不足**：检查火山引擎账户余额和API调用次数
4. **提示词不合规**：确保提示词符合内容安全规范

### 调试方法

运行时添加调试信息：
```bash
DEBUG=* node build/index.js
```

## 许可证

ISC License 