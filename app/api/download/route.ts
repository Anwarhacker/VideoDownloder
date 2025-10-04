import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { createReadStream, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import connectToDatabase from '@/lib/mongodb';
import DownloadSession from '@/lib/models/DownloadSession';

// Fallback in-memory storage for when MongoDB is not available
interface FallbackSession {
  id: string;
  status: 'downloading' | 'completed' | 'error';
  progress: number;
  error?: string;
  tempFile?: string;
  contentType: string;
  filename: string;
}

const fallbackSessions = new Map<string, FallbackSession>();
let useMongoDB = true; // Flag to track if we're using MongoDB or fallback

// Get yt-dlp command - try system PATH first, then local exe for development
function getYtdlpCommand(): string {
  // For production, assume yt-dlp is in PATH
  // For development, use local exe
  try {
    // In development, check if local exe exists
    const localPath = join(process.cwd(), 'yt-dlp.exe');
    // For simplicity, use 'yt-dlp' for production, local path for dev
    return process.env.NODE_ENV === 'production' ? 'yt-dlp' : localPath;
  } catch {
    return 'yt-dlp';
  }
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const isMongoDBAvailable = db !== null;

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    const action = searchParams.get('action');

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    let session: any = null;

    if (isMongoDBAvailable) {
      session = await DownloadSession.findOne({ sessionId: id });
    } else {
      session = fallbackSessions.get(id);
    }

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
      fileStream.on('end', async () => {
        try {
          unlinkSync(session.tempFile!);
          if (isMongoDBAvailable) {
            await DownloadSession.deleteOne({ sessionId: id });
          } else {
            fallbackSessions.delete(id);
          }
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
  } catch (error) {
    console.error('GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await connectToDatabase();
    const isMongoDBAvailable = db !== null;

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
        formatString = 'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best';
        break;
      default:
        formatString = 'bestvideo+bestaudio/best';
    }

    const contentType = quality === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const fileExtension = quality === 'audio' ? 'mp3' : 'mp4';
    const filename = `download.${fileExtension}`;
    const tempFile = join(tmpdir(), `download-${randomUUID()}.${fileExtension}`);

    const sessionId = randomUUID();

    // Create session in MongoDB or fallback storage
    let session: any;
    if (isMongoDBAvailable) {
      session = await DownloadSession.create({
        sessionId,
        url,
        quality,
        status: 'downloading',
        progress: 0,
        contentType,
        filename,
        tempFile,
      });
    } else {
      session = {
        id: sessionId,
        status: 'downloading',
        progress: 0,
        contentType,
        filename,
        tempFile,
      };
      fallbackSessions.set(sessionId, session);
    }

    const args = [
      '-f', formatString,
      '-o', tempFile,
      '--no-playlist',
      url
    ];

    if (quality === 'audio') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0', '--audio-codec', 'libmp3lame');
    } else {
      args.push('--merge-output-format', 'mp4');
    }

    const ytdlpCmd = getYtdlpCommand();
    const ytdlp = spawn(ytdlpCmd, args);

    // Progress simulation timer for fallback
    let progressTimer: NodeJS.Timeout | null = null;
    let lastRealProgress = 0;
    let simulationStep = 0;

    const startProgressSimulation = () => {
      if (progressTimer) return; // Already running

      progressTimer = setInterval(async () => {
        try {
          // Only simulate if we haven't seen real progress recently
          const timeSinceLastProgress = Date.now() - lastRealProgress;
          if (timeSinceLastProgress > 5000) { // 5 seconds without real progress
            simulationStep++;
            let simulatedProgress = session.progress;

            if (simulationStep === 1 && simulatedProgress < 25) simulatedProgress = 25;
            else if (simulationStep === 2 && simulatedProgress < 50) simulatedProgress = 50;
            else if (simulationStep === 3 && simulatedProgress < 75) simulatedProgress = 75;
            else if (simulationStep >= 4 && simulatedProgress < 90) simulatedProgress = 90;

            if (simulatedProgress > session.progress) {
              if (isMongoDBAvailable) {
                await DownloadSession.updateOne(
                  { sessionId },
                  { progress: simulatedProgress }
                );
              } else {
                session.progress = simulatedProgress;
              }
              console.log('Simulated progress:', simulatedProgress);
            }
          }
        } catch (error) {
          console.error('Error in progress simulation:', error);
        }
      }, 2000); // Update every 2 seconds
    };

    // Start simulation after a short delay
    setTimeout(startProgressSimulation, 2000);

    ytdlp.stderr.on('data', async (data) => {
      const output = data.toString();
      console.log('yt-dlp stderr:', output.trim()); // Debug logging

      try {
        let newProgress = session.progress;

        // Try multiple regex patterns for progress with more comprehensive matching
        let progressMatch = output.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (!progressMatch) {
          progressMatch = output.match(/(\d+(?:\.\d+)?)%\s+of/);
        }
        if (!progressMatch) {
          progressMatch = output.match(/(\d+(?:\.\d+)?)%/);
        }
        if (!progressMatch) {
          progressMatch = output.match(/(\d+)%/);
        }

        if (progressMatch) {
          newProgress = Math.max(newProgress, parseFloat(progressMatch[1]));
          console.log('Progress match found:', newProgress);
        }

        // Check for specific yt-dlp progress indicators
        if (output.includes('[download]') && output.includes('Destination:')) {
          newProgress = Math.max(newProgress, 5);
        }
        if (output.includes('[download]') && output.includes('100%')) {
          newProgress = 100;
        }
        if (output.includes('has already been downloaded')) {
          newProgress = 100;
        }

        // Simulate progress if no real progress detected
        if (newProgress === session.progress && output.includes('[download]')) {
          // If we see download activity but no percentage, increment gradually
          if (session.progress < 10) newProgress = 10;
          else if (session.progress < 25) newProgress = 25;
          else if (session.progress < 50) newProgress = 50;
          else if (session.progress < 75) newProgress = 75;
          else if (session.progress < 100) newProgress = 90;
        }

        // Update progress if it changed
        if (newProgress !== session.progress) {
          newProgress = Math.min(newProgress, 100);

          if (isMongoDBAvailable) {
            await DownloadSession.updateOne(
              { sessionId },
              { progress: newProgress }
            );
          } else {
            session.progress = newProgress;
          }

          // Reset simulation timer since we got real progress
          lastRealProgress = Date.now();
          simulationStep = 0;

          console.log('Real progress updated to:', newProgress);
        }

        // Force completion on certain outputs
        if (output.includes('Merging formats') || output.includes('Deleting original file')) {
          if (isMongoDBAvailable) {
            await DownloadSession.updateOne(
              { sessionId },
              { progress: 100 }
            );
          } else {
            session.progress = 100;
          }
          console.log('Forced completion progress to 100%');
        }

      } catch (error) {
        console.error('Error updating progress:', error);
      }
    });

    ytdlp.on('close', async (code) => {
      try {
        // Clean up progress timer
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        if (code === 0) {
          if (isMongoDBAvailable) {
            await DownloadSession.updateOne(
              { sessionId },
              { status: 'completed', progress: 100 }
            );
          } else {
            session.status = 'completed';
            session.progress = 100;
          }
          console.log('Download completed successfully');
        } else {
          const errorMsg = `Download failed with code ${code}`;
          if (isMongoDBAvailable) {
            await DownloadSession.updateOne(
              { sessionId },
              {
                status: 'error',
                error: errorMsg
              }
            );
          } else {
            session.status = 'error';
            session.error = errorMsg;
          }
          console.log('Download failed:', errorMsg);
          // Clean up temp file
          if (existsSync(tempFile)) {
            try {
              unlinkSync(tempFile);
            } catch (err) {
              console.error('Failed to clean up temp file on error:', err);
            }
          }
        }
      } catch (error) {
        console.error('Error updating session status:', error);
      }
    });

    ytdlp.on('error', async (error) => {
      try {
        // Clean up progress timer
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }

        console.log('yt-dlp spawn error:', error.message);
        if (isMongoDBAvailable) {
          await DownloadSession.updateOne(
            { sessionId },
            {
              status: 'error',
              error: error.message
            }
          );
        } else {
          session.status = 'error';
          session.error = error.message;
        }
        if (existsSync(tempFile)) {
          try {
            unlinkSync(tempFile);
          } catch (err) {
            console.error('Failed to clean up temp file on error:', err);
          }
        }
      } catch (updateError) {
        console.error('Error updating session on spawn error:', updateError);
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
