import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { createReadStream, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

interface DownloadSession {
  id: string;
  status: 'downloading' | 'completed' | 'error';
  progress: number;
  error?: string;
  tempFile?: string;
  contentType: string;
  filename: string;
}

const downloadSessions = new Map<string, DownloadSession>();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id');
  const action = searchParams.get('action');

  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 });
  }

  const session = downloadSessions.get(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (action === 'progress') {
    return NextResponse.json({
      status: session.status,
      progress: session.progress,
      error: session.error,
    });
  }

  if (action === 'file') {
    if (session.status !== 'completed' || !session.tempFile) {
      return NextResponse.json({ error: 'Download not ready' }, { status: 400 });
    }

    const fileStream = createReadStream(session.tempFile);

    // Clean up after streaming
    fileStream.on('end', () => {
      try {
        unlinkSync(session.tempFile!);
        downloadSessions.delete(id);
      } catch (err) {
        console.error('Failed to clean up:', err);
      }
    });

    return new NextResponse(Readable.toWeb(fileStream) as any, {
      headers: {
        'Content-Type': session.contentType,
        'Content-Disposition': `attachment; filename="${session.filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function POST(request: NextRequest) {
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
    const tempFile = join(tmpdir(), `download-${randomUUID()}.${fileExtension}`);

    const sessionId = randomUUID();
    const session: DownloadSession = {
      id: sessionId,
      status: 'downloading',
      progress: 0,
      contentType,
      filename,
      tempFile,
    };

    downloadSessions.set(sessionId, session);

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

    const ytdlp = spawn('c:\\Dev-projects\\videoDownloader\\project\\yt-dlp.exe', args);

    ytdlp.stderr.on('data', (data) => {
      const output = data.toString();
      const progressMatch = output.match(/\[download\]\s*(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        session.progress = parseFloat(progressMatch[1]);
      }
    });

    ytdlp.on('close', (code) => {
      if (code === 0) {
        session.status = 'completed';
      } else {
        session.status = 'error';
        session.error = `Download failed with code ${code}`;
        // Clean up temp file
        if (existsSync(tempFile)) {
          try {
            unlinkSync(tempFile);
          } catch (err) {
            console.error('Failed to clean up temp file on error:', err);
          }
        }
      }
    });

    ytdlp.on('error', (error) => {
      session.status = 'error';
      session.error = error.message;
      if (existsSync(tempFile)) {
        try {
          unlinkSync(tempFile);
        } catch (err) {
          console.error('Failed to clean up temp file on error:', err);
        }
      }
    });

    return NextResponse.json({ id: sessionId });
  } catch (error: any) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate download' },
      { status: 500 }
    );
  }
}
