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
  "4:3": { width: 768, height: 576},
  "3:4": { width: 576, height: 768 }, 
  "16:9": { width: 768, height: 432},
  "9:16": { width: 432, height: 768 }
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
function generatePrompt(content: string, style: string): string {
  let prompt = `生成一张图片，内容是：${content}`

  if (style != undefined && style.length > 0) {
    prompt += `，图片风格是：${style}`
  }

  return prompt
}

// 调用即梦AI API
async function callJimengAPI(prompt: string, ratio: { width: number; height: number }, use_pre_llm: boolean = false): Promise<string | null> {
  // 查询参数
  const queryParams = {
    'Action': 'CVProcess',
    'Version': '2022-08-31'
  };
  const formattedQuery = formatQuery(queryParams);

  // 请求体参数
  const bodyParams = {
    req_key: "jimeng_high_aes_general_v21_L",
    use_pre_llm: use_pre_llm,
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
    prompt: z.string().describe("图片的描述文本"),
    illustration: z.string().describe("图片风格关键词"),
    ratio: z.enum(["4:3", "3:4", "16:9", "9:16"]).describe("图片比例。支持: 4:3 (768*576), 3:4 (576*768), 16:9 (768*432), 9:16 (432*768)"),
    use_pre_llm: z.boolean().describe("是否需要LLM进行扩写优化"),
  },
  async ({ prompt, illustration, ratio, use_pre_llm }: { prompt: string; illustration: string; ratio: string, use_pre_llm: boolean }) => {
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
    const final_prompt = generatePrompt(prompt, illustration);
    const imageUrl = await callJimengAPI(final_prompt, imageSize, use_pre_llm);

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
          text: `图片生成成功！\n\nPrompt: ${final_prompt}\n图片比例: ${ratio} (${imageSize.width}×${imageSize.height})\n图片URL: ${imageUrl}`
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