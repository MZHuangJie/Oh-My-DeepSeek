import path from 'path';
import type { ContentPart } from './types';
import { describeImage, type VisionModelConfig } from '../services/vision';

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const AT_IMAGE_RE = /@([A-Za-z]:[\\/][^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function normalizePath(p: string): string {
  return p.trim().replace(/^["']|["']$/g, '');
}

const DATA_IMAGE_RE = /^data:image\/\w+;base64,/i;

/** 从文本中提取图片路径（markdown 粘贴格式 + @ 引用 + data URL） */
export function extractImagePaths(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const p = normalizePath(match[1]);
    if (p && (IMAGE_EXT_RE.test(p) || /\.ohmydeepseek[/\\]clipboard/i.test(p) || DATA_IMAGE_RE.test(p))) {
      found.add(p);
    }
  }

  AT_IMAGE_RE.lastIndex = 0;
  for (const match of text.matchAll(AT_IMAGE_RE)) {
    found.add(normalizePath(match[1]));
  }

  return [...found];
}

function formatVisionBlock(filePath: string, description: string): string {
  const name = filePath.startsWith('data:') ? '粘贴图片' : path.basename(filePath);
  return `【图片 ${name} 内容描述】\n${description}`;
}

/**
 * 非多模态模型：在发给 LLM 前自动调用 Vision 模型，将图片描述注入 user 消息。
 * 多模态 ContentPart[] 原样返回。
 */
export async function enrichMessageWithVisionDescriptions(
  message: string | ContentPart[],
  visionConfig: VisionModelConfig,
  signal?: AbortSignal,
): Promise<string | ContentPart[]> {
  if (Array.isArray(message)) return message;

  const paths = extractImagePaths(message);
  if (paths.length === 0) return message;

  const blocks: string[] = [];
  for (const filePath of paths) {
    try {
      const desc = await describeImage(visionConfig, filePath, undefined, signal);
      blocks.push(formatVisionBlock(filePath, desc));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      blocks.push(`【图片 ${path.basename(filePath)} 识别失败】${msg}`);
    }
  }

  return `${message}\n\n${blocks.join('\n\n')}`;
}
