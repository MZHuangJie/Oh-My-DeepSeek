import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { buildChatCompletionsUrl as buildOpenAIChatUrl } from './openai-endpoints';

export interface VisionModelConfig {
  enabled?: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  useActiveModel?: boolean;
}

interface ImagePayload {
  mime: string;
  base64: string;
  userPrompt: string;
}

function loadImagePayload(imagePath: string, prompt?: string): ImagePayload {
  // 支持 data URL：直接解析 base64，无需读取文件
  const dataUrlMatch = imagePath.match(/^data:(image\/\w+);base64,(.+)$/i);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1];
    const base64 = dataUrlMatch[2];
    const userPrompt = prompt || '请详细描述这张图片的内容，包括画面主体、场景、文字、颜色等所有可见信息。用中文回复。';
    return { mime, base64, userPrompt };
  }

  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`图片文件不存在: ${imagePath}`);
  }

  const buf = fs.readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image/png';
  const userPrompt = prompt || '请详细描述这张图片的内容，包括画面主体、场景、文字、颜色等所有可见信息。用中文回复。';

  return { mime, base64: buf.toString('base64'), userPrompt };
}

/** 从 OpenAI 兼容响应中提取文本（支持 string / content 数组 / reasoning_content） */
export function extractOpenAIMessageText(parsed: Record<string, unknown>): string {
  const message = (parsed.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0]?.message;
  if (!message) return '';

  const content = message.content;
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n').trim();
  }

  if (typeof message.reasoning_content === 'string') {
    return message.reasoning_content.trim();
  }

  return '';
}

function parseOpenAIChatResponse(data: string): string {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  const text = extractOpenAIMessageText(parsed);
  if (text) return text;
  throw new Error('视觉模型响应中未找到有效文本内容');
}

function isAnthropicVision(config: VisionModelConfig): boolean {
  return config.baseUrl.includes('anthropic.com') || config.model.toLowerCase().includes('claude');
}

function httpJsonRequest(
  url: URL,
  headers: Record<string, string>,
  body: string,
  signal?: AbortSignal,
  parseText: (data: string) => string = parseOpenAIChatResponse,
): Promise<string> {
  const isHttps = url.protocol === 'https:';

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));

    const onAbort = () => {
      req.destroy(new Error('Aborted'));
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
    };

    const requestFn = isHttps ? https.request : http.request;
    const req = requestFn(options, (res) => {
      const status = res.statusCode ?? 0;
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => {
        signal?.removeEventListener('abort', onAbort);
        if (status < 200 || status >= 300) {
          let detail = data.trim();
          try { const p = JSON.parse(detail); detail = p.error?.message || p.message || detail; } catch {}
          reject(new Error(`Vision API ${status}: ${detail.slice(0, 300)}`));
          return;
        }
        try {
          resolve(parseText(data));
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          reject(new Error(`解析 Vision 响应失败: ${msg}`));
        }
      });
      res.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    });

    req.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err); });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Vision API 超时（60秒）')); });
    req.write(body);
    req.end();
  });
}

async function describeImageOpenAI(
  config: VisionModelConfig,
  payload: ImagePayload,
  signal?: AbortSignal,
): Promise<string> {
  const body = JSON.stringify({
    model: config.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: payload.userPrompt },
        { type: 'image_url', image_url: { url: `data:${payload.mime};base64,${payload.base64}` } },
      ],
    }],
    max_tokens: 1024,
  });

  const url = buildOpenAIChatUrl(config.baseUrl);

  return httpJsonRequest(url, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  }, body, signal);
}

async function describeImageAnthropic(
  config: VisionModelConfig,
  payload: ImagePayload,
  signal?: AbortSignal,
): Promise<string> {
  const base = config.baseUrl.replace(/\/$/, '');
  const url = base.endsWith('/v1')
    ? new URL(`${base}/messages`)
    : new URL(`${base}/v1/messages`);

  const body = JSON.stringify({
    model: config.model,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: payload.mime, data: payload.base64 },
        },
        { type: 'text', text: payload.userPrompt },
      ],
    }],
  });

  return httpJsonRequest(url, {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  }, body, signal, (data) => {
    const parsed = JSON.parse(data);
    const block = parsed.content?.find((b: { type?: string }) => b.type === 'text');
    const text = typeof block?.text === 'string' ? block.text.trim() : '';
    if (text) return text;
    throw new Error('视觉模型响应中未找到有效文本内容');
  });
}

export async function describeImage(
  config: VisionModelConfig,
  imagePath: string,
  prompt?: string,
  signal?: AbortSignal,
): Promise<string> {
  const payload = loadImagePayload(imagePath, prompt);
  if (isAnthropicVision(config)) {
    return describeImageAnthropic(config, payload, signal);
  }
  return describeImageOpenAI(config, payload, signal);
}
