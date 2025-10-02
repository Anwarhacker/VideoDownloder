import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { createReadStream, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let tempFile: string | null = null;

  try {
    const { url, quality } = await request.json();

    if (!url || !quality) {
      return NextResponse.json(
        { error: 'URL and quality are required' },
        { status: 400 }
      );
    }

    let formatString = '';

    switch (quality) {
      case '2160p':
        formatString = 'bestvideo[height<=2160]+bestaudio/best[height<=2160]';
        break;
      case '1440p':
        formatString = 'bestvideo[height<=1440]+bestaudio/best[height<=1440]';
        break;
      case '1080p':
        formatString = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]';
        break;
      case '720p':
        formatString = 'bestvideo[height<=720]+bestaudio/best[height<=720]';
        break;
      case '480p':
        formatString = 'bestvideo[height<=480]+bestaudio/best[height<=480]';
        break;
      case 'audio':
        formatString = 'bestaudio/best';
        break;
      default:
        formatString = 'bestvideo+bestaudio/best';
    }

    const contentType = quality === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const fileExtension = quality === 'audio' ? 'mp3' : 'mp4';
    const filename = `download.${fileExtension}`;
    tempFile = join(tmpdir(), `download-${randomUUID()}.${fileExtension}`);

    const args = [
      '-f', formatString,
      '-o', tempFile,
      '--no-playlist',
      '--merge-output-format', quality === 'audio' ? 'mp3' : 'mp4',
      url
    ];

    if (quality === 'audio') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    }

    await new Promise<void>((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', args);

      ytdlp.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`yt-dlp exited with code ${code}`));
        }
      });

      ytdlp.on('error', (error) => {
        reject(error);
      });
    });

    // Now stream the file
    const fileStream = createReadStream(tempFile);

    // Clean up temp file after streaming starts
    fileStream.on('end', () => {
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch (err) {
          console.error('Failed to clean up temp file:', err);
        }
      }
    });

    return new NextResponse(Readable.toWeb(fileStream) as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('Download error:', error);
    // Clean up temp file on error
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch (err) {
        console.error('Failed to clean up temp file on error:', err);
      }
    }
    return NextResponse.json(
      { error: 'Failed to download video' },
      { status: 500 }
    );
  }
}
