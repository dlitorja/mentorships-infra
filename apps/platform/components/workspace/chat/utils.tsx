'use client';

import { toast } from 'sonner';
import type { DownloadError, ParsedFileMessage } from './types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shouldSkipDownloadFallback(error: unknown): error is DownloadError {
  return error instanceof Error && 'skipFallback' in error && error.skipFallback === true;
}

function decodeFileName(encodedFileName: string, fallback: string): string {
  try {
    return decodeURIComponent(encodedFileName) || fallback;
  } catch {
    return encodedFileName || fallback;
  }
}

export function parseFileMessage(content: string): ParsedFileMessage {
  const separatorIndex = content.indexOf('|');
  if (separatorIndex === -1) {
    return { fileName: 'Download file', url: content };
  }

  const encodedFileName = content.slice(0, separatorIndex);
  const url = content.slice(separatorIndex + 1);

  return { fileName: decodeFileName(encodedFileName, 'Download file'), url };
}

export function parseImageMessage(content: string): ParsedFileMessage {
  const parsed = parseFileMessage(content);
  return parsed.fileName === 'Download file'
    ? { fileName: 'Shared image', url: parsed.url }
    : parsed;
}

export function isImageFileName(fileName: string): boolean {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(fileName);
}

export async function downloadFile(url: string, fileName: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let responseStarted = false;

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const error: DownloadError = new Error('Download failed');
      error.skipFallback = true;
      throw error;
    }

    responseStarted = true;
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    console.error('Failed to download file:', error);
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    if (isAbort) {
      toast.error('Download timed out. Please try again.');
      return;
    }

    if (shouldSkipDownloadFallback(error)) {
      toast.error('Download failed. Please try again.');
      return;
    }

    if (responseStarted) {
      toast.error('Download was interrupted. Please try again.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    toast.info('File opened in a new tab if your browser allowed it');
  } finally {
    clearTimeout(timeout);
  }
}

export const URL_REGEX = /(?:(?:https?|ftp):\/\/)?(?:www\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|io|co|app|dev|xyz|gg|info|biz|me|pro|site|online|store|tech|ai|cloud|sh|vc|fm|ly|to|cm|nu|kiwi|work|life|homes|systems|group|fyi|day|cool|world|top|zone|blog|chat|mail|email|center|shop|market|media|news|press|pub|space|team|live|plus|web)\b(?:[/?#][^\s<]*)?/gi;

const TRAILING_URL_PUNCTUATION_REGEX = /[.,!?:;]+$/;

function splitUrlTrailingPunctuation(url: string): { cleanUrl: string; trailingText: string } {
  let cleanUrl = url;
  let trailingText = '';

  while (cleanUrl.length > 0) {
    const punctuation = cleanUrl.match(TRAILING_URL_PUNCTUATION_REGEX)?.[0];
    if (punctuation) {
      cleanUrl = cleanUrl.slice(0, -punctuation.length);
      trailingText = punctuation + trailingText;
      continue;
    }

    const lastChar = cleanUrl.at(-1);
    if (lastChar === ')' && (cleanUrl.match(/\)/g)?.length ?? 0) > (cleanUrl.match(/\(/g)?.length ?? 0)) {
      cleanUrl = cleanUrl.slice(0, -1);
      trailingText = ')' + trailingText;
      continue;
    }

    if (lastChar === ']' && (cleanUrl.match(/\]/g)?.length ?? 0) > (cleanUrl.match(/\[/g)?.length ?? 0)) {
      cleanUrl = cleanUrl.slice(0, -1);
      trailingText = ']' + trailingText;
      continue;
    }

    break;
  }

  return { cleanUrl, trailingText };
}

function isEmailDomainMatch(content: string, index: number): boolean {
  return index > 0 && content[index - 1] === '@';
}

export function normalizeUrl(url: string): string {
  if (!url.match(/^(https?|ftp):\/\//i)) {
    return 'https://' + url;
  }
  return url;
}

export function extractUrls(content: string): string[] {
  const matches = [...content.matchAll(URL_REGEX)]
    .filter((match) => !isEmailDomainMatch(content, match.index ?? 0))
    .map((match) => splitUrlTrailingPunctuation(match[0]).cleanUrl);
  return [...new Set(matches)];
}

export function renderMessageWithLinks(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(URL_REGEX)) {
    const { cleanUrl, trailingText } = splitUrlTrailingPunctuation(match[0]);
    const index = match.index ?? 0;
    if (isEmailDomainMatch(content, index)) {
      continue;
    }

    if (index > lastIndex) {
      nodes.push(content.slice(lastIndex, index));
    }

    nodes.push(
      <a
        key={`${cleanUrl}-${index}`}
        href={normalizeUrl(cleanUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline hover:opacity-80 break-all"
      >
        {cleanUrl}
      </a>
    );
    if (trailingText) {
      nodes.push(trailingText);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}
