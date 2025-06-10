#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "crypto";

// 火山引擎即梦AI API配置
const ENDPOINT = "https://visual.volcengineapi.com";
const HOST = "visual.volcengineapi.com";
const REGION = "cn-north-1";
const SERVICE = "cv";

// 环境变量配置
const JIMENG_ACCESS_KEY = process.env.JIMENG_ACCESS_KEY;
const JIMENG_SECRET_KEY = process.env.JIMENG_SECRET_KEY;

if (!JIMENG_ACCESS_KEY || !JIMENG_SECRET_KEY) {
  console.error("警告：未设置环境变量 JIMENG_ACCESS_KEY 和 JIMENG_SECRET_KEY");
  console.error("服务将启动但无法调用API功能，仅供测试使用");
}

// 图片比例映射
const RATIO_MAPPING: Record<string, { width: number; height: number }> = {
  "4:3": { width: 512, height: 384 },
  "3:4": { width: 384, height: 512 }, 
  "16:9": { width: 512, height: 288 },
  "9:16": { width: 288, height: 512 }
};

// 辅助函数：生成签名密钥
function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
  const kDate = crypto.createHmac('sha256', key).update(dateStamp).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
  return kSigning;
}

// 格式化查询参数
function formatQuery(parameters: Record<string, string>): string {
  const sortedKeys = Object.keys(parameters).sort();
  return sortedKeys.map(key => `${key}=${parameters[key]}`).join('&');
}

// 火山引擎V4签名算法
function signV4Request(
  accessKey: string,
  secretKey: string,
  service: string,
  reqQuery: string,
  reqBody: string
): { headers: Record<string, string>; requestUrl: string } {
  const t = new Date();
  const currentDate = t.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  const datestamp = currentDate.substring(0, 8);
  
  const method = 'POST';
  const canonicalUri = '/';
  const canonicalQuerystring = reqQuery;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const payloadHash = crypto.createHash('sha256').update(reqBody).digest('hex');
  const contentType = 'application/json';
  
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${HOST}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${currentDate}`
  ].join('\n') + '\n';
  
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  const algorithm = 'HMAC-SHA256';
  const credentialScope = `${datestamp}/${REGION}/${service}/request`;
  const stringToSign = [
    algorithm,
    currentDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  const signingKey = getSignatureKey(secretKey, datestamp, REGION, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  
  const authorizationHeader = `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  
  const headers = {
    'X-Date': currentDate,
    'Authorization': authorizationHeader,
    'X-Content-Sha256': payloadHash,
    'Content-Type': contentType
  };
  
  const requestUrl = `${ENDPOINT}?${canonicalQuerystring}`;
  
  return { headers, requestUrl };
}

// 生成组合后的prompt
function generatePrompt(text: string, illustration: string, color: string): string {
  return `字体设计："${text}"，黑色字体，斜体，带阴影。干净的背景，白色到${color}渐变。点缀浅灰色、半透明${illustration}等元素插图做配饰插画。`;
}

// 调用即梦AI API
async function callJimengAPI(prompt: string, ratio: { width: number; height: number }): Promise<string | null> {
  // 查询参数
  const queryParams = {
    'Action': 'CVProcess',
    'Version': '2022-08-31'
  };
  const formattedQuery = formatQuery(queryParams);

  // 请求体参数
  const bodyParams = {
    req_key: "jimeng_high_aes_general_v21_L",
    prompt: prompt,
    return_url: true,
    width: ratio.width,
    height: ratio.height
  };
  const formattedBody = JSON.stringify(bodyParams);

  try {
    // 生成签名和请求头
    const { headers, requestUrl } = signV4Request(
      JIMENG_ACCESS_KEY!,
      JIMENG_SECRET_KEY!,
      SERVICE,
      formattedQuery,
      formattedBody
    );

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: headers,
      body: formattedBody
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();
    // 替换转义字符，与Python示例保持一致
    const cleanedResponse = responseText.replace(/\\u0026/g, "&");
    const result = JSON.parse(cleanedResponse);
    
    // 根据火山引擎即梦AI API响应格式解析结果
    if (result.ResponseMetadata && result.ResponseMetadata.Error) {
      throw new Error(`API error: ${result.ResponseMetadata.Error.Message || 'Unknown error'}`);
    }

    // 返回生成的图片URL - 根据搜索结果，即梦AI返回的是data.image_urls数组
    if (result.data && result.data.image_urls && result.data.image_urls.length > 0) {
      return result.data.image_urls[0];
    }
    
    return null;
  } catch (error) {
    console.error("调用即梦AI API时出错:", error);
    return null;
  }
}

// 创建MCP服务器实例
const server = new McpServer({
  name: "jimengpic",
  version: "1.0.0",
});

// 注册图片生成工具
server.tool(
  "generate-image",
  "当用户需要生成图片时使用的工具",
  {
    text: z.string().describe("用户需要在图片上显示的文字"),
    illustration: z.string().describe("根据用户要显示的文字，提取3-5个可以作为图片配饰的插画元素关键词"),
    color: z.string().describe("图片的背景主色调"),
    ratio: z.enum(["4:3", "3:4", "16:9", "9:16"]).describe("图片比例。支持: 4:3 (512*384), 3:4 (384*512), 16:9 (512*288), 9:16 (288*512)")
  },
  async ({ text, illustration, color, ratio }: { text: string; illustration: string; color: string; ratio: string }) => {
    const imageSize = RATIO_MAPPING[ratio];
    
    if (!imageSize) {
      return {
        content: [
          {
            type: "text",
            text: `错误：不支持的图片比例 ${ratio}。支持的比例: 4:3, 3:4, 16:9, 9:16`
          }
        ]
      };
    }

    // 检查API密钥是否配置
    if (!JIMENG_ACCESS_KEY || !JIMENG_SECRET_KEY) {
      return {
        content: [
          {
            type: "text",
            text: "错误：未设置环境变量 JIMENG_ACCESS_KEY 和 JIMENG_SECRET_KEY，无法调用API。"
          }
        ]
      };
    }

    // 生成组合后的prompt
    const prompt = generatePrompt(text, illustration, color);

    const imageUrl = await callJimengAPI(prompt, imageSize);

    if (!imageUrl) {
      return {
        content: [
          {
            type: "text",
            text: "生成图片失败，请检查网络连接和API密钥配置。"
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `图片生成成功！\n\n显示文字: ${text}\n配饰元素: ${illustration}\n背景色调: ${color}\n图片比例: ${ratio} (${imageSize.width}×${imageSize.height})\n生成提示词: ${prompt}\n图片URL: ${imageUrl}`
        }
      ]
    };
  }
);

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("即梦AI图片生成MCP服务已启动");
}

main().catch((error) => {
  console.error("启动服务时发生错误:", error);
  process.exit(1);
}); 