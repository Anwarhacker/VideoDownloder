"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Video,
  Loader as Loader2,
  CircleAlert as AlertCircle,
  CircleCheck as CheckCircle2,
  Info,
  History,
  X,
  Copy,
  ExternalLink,
  Zap,
  Shield,
  Globe,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  formatFileSize,
  formatDuration,
  getQualityLabel,
  validateUrl,
} from "@/lib/format-utils";
import { toast } from "sonner";

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  description: string;
  availableQualities: string[];
  estimatedSizes: { [key: string]: number };
}

interface DownloadState {
  status: "idle" | "fetching" | "ready" | "downloading" | "completed" | "error";
  progress: number;
  error?: string;
}

interface DownloadHistory {
  id: string;
  title: string;
  url: string;
  quality: string;
  size: number;
  date: Date;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedQuality, setSelectedQuality] = useState("1080p");
  const [downloadState, setDownloadState] = useState<DownloadState>({
    status: "idle",
    progress: 0,
  });
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load download history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem("downloadHistory");
    if (savedHistory) {
      try {
        setDownloadHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse download history", e);
      }
    }
  }, []);

  // Save download history to localStorage when it changes
  useEffect(() => {
    if (downloadHistory.length > 0) {
      localStorage.setItem("downloadHistory", JSON.stringify(downloadHistory));
    }
  }, [downloadHistory]);

  const handleFetchInfo = async () => {
    if (!url.trim()) {
      toast.error("Please enter a video URL");
      inputRef.current?.focus();
      return;
    }

    if (!validateUrl(url)) {
      toast.error("Invalid URL or unsupported platform");
      inputRef.current?.focus();
      return;
    }

    setDownloadState({ status: "fetching", progress: 0 });
    setVideoInfo(null);

    try {
      const response = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch video info");
      }

      setVideoInfo(data);
      if (data.availableQualities.length > 0) {
        setSelectedQuality(data.availableQualities[0]);
      }
      setDownloadState({ status: "ready", progress: 0 });
      toast.success("Video information loaded successfully");
    } catch (error: any) {
      setDownloadState({ status: "error", progress: 0, error: error.message });
      toast.error(error.message);
    }
  };

  const handleDownload = async () => {
    if (!videoInfo) return;

    setDownloadState({ status: "downloading", progress: 0 });

    try {
      // Start download
      const startResponse = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, quality: selectedQuality }),
      });

      if (!startResponse.ok) {
        const errorData = await startResponse.json();
        throw new Error(errorData.error || "Failed to start download");
      }

      const { id } = await startResponse.json();

      // Poll for progress
      const pollProgress = async () => {
        try {
          const progressResponse = await fetch(
            `/api/download?action=progress&id=${id}`
          );
          if (!progressResponse.ok) {
            throw new Error("Failed to get progress");
          }

          const progressData = await progressResponse.json();

          if (progressData.status === "completed") {
            // Download the file
            const fileResponse = await fetch(
              `/api/download?action=file&id=${id}`
            );
            if (!fileResponse.ok) {
              throw new Error("Failed to download file");
            }

            const blob = await fileResponse.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = `${videoInfo.title}.${
              selectedQuality === "audio" ? "mp3" : "mp4"
            }`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);

            // Add to download history
            const newHistoryItem: DownloadHistory = {
              id,
              title: videoInfo.title,
              url,
              quality: selectedQuality,
              size: videoInfo.estimatedSizes[selectedQuality],
              date: new Date(),
            };
            setDownloadHistory((prev) => [newHistoryItem, ...prev].slice(0, 10)); // Keep only last 10 items

            setDownloadState({ status: "completed", progress: 100 });
            toast.success("Download completed successfully!");
          } else if (progressData.status === "error") {
            throw new Error(progressData.error || "Download failed");
          } else {
            setDownloadState({
              status: "downloading",
              progress: progressData.progress,
            });
            setTimeout(pollProgress, 1000); // Poll again in 1 second
          }
        } catch (error: any) {
          setDownloadState({
            status: "error",
            progress: 0,
            error: error.message,
          });
          toast.error(error.message);
        }
      };

      pollProgress();
    } catch (error: any) {
      setDownloadState({ status: "error", progress: 0, error: error.message });
      toast.error(error.message);
    }
  };

  const handleReset = () => {
    setUrl("");
    setVideoInfo(null);
    setDownloadState({ status: "idle", progress: 0 });
    setSelectedQuality("1080p");
    inputRef.current?.focus();
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(url);
    setUrlCopied(true);
    toast.success("URL copied to clipboard");
    setTimeout(() => setUrlCopied(false), 2000);
  };

  const handleHistoryItemClick = (item: DownloadHistory) => {
    setUrl(item.url);
    setShowHistory(false);
    handleFetchInfo();
  };

  const handleClearHistory = () => {
    setDownloadHistory([]);
    localStorage.removeItem("downloadHistory");
    toast.success("Download history cleared");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/50 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-100/20 via-transparent to-cyan-100/20"></div>
      <div className="absolute top-20 left-10 w-32 h-32 bg-blue-200/30 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute top-40 right-20 w-24 h-24 bg-cyan-200/30 rounded-full blur-2xl animate-pulse delay-1000"></div>

      <div className="container mx-auto px-4 py-6 sm:py-8 max-w-5xl relative z-10">
        <div className="text-center mb-8 sm:mb-12 pt-4 sm:pt-8">
          <div className="flex flex-col space-y-4 items-center justify-center mb-6 animate-in fade-in slide-in-from-top-4 duration-700">
            <div className="relative group">
              <div className="absolute -inset-4 bg-gradient-to-r from-blue-400/20 to-cyan-400/20 rounded-full blur-lg group-hover:blur-xl transition-all duration-300"></div>
              <Video className="w-12 h-12 sm:w-16 sm:h-16 text-blue-600 relative z-10 drop-shadow-lg group-hover:scale-110 transition-transform duration-300" />
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-blue-600 via-cyan-600 to-teal-600 bg-clip-text text-transparent animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 hover:scale-105 transition-transform duration-300">
              Video Downloader
            </h1>
          </div>
          <p className="text-slate-600 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed animate-in fade-in duration-700 delay-400">
            Download videos from YouTube, Vimeo, and many more platforms with
            lightning-fast speed and high quality
          </p>
        </div>

        <Card className="shadow-2xl border-0 bg-white/90 backdrop-blur-md hover:shadow-3xl transition-all duration-300 hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-600">
          <CardHeader className="bg-gradient-to-r from-blue-50/50 to-cyan-50/50 border-b border-slate-100/50">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-2xl flex items-center gap-3 text-slate-800">
                  <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg shadow-lg">
                    <Download className="w-6 h-6 text-white" />
                  </div>
                  Download Video
                </CardTitle>
                <CardDescription className="text-slate-600 text-base mt-2">
                  Enter a video URL and select your preferred quality for instant
                  download
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                className="text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-all duration-200"
              >
                <History className="w-5 h-5 mr-1" />
                History
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {showHistory && downloadHistory.length > 0 && (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-medium text-slate-700">Recent Downloads</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearHistory}
                    className="text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Clear
                  </Button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {downloadHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-2 bg-white rounded-md hover:bg-blue-50 cursor-pointer transition-colors duration-200"
                      onClick={() => handleHistoryItemClick(item)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">
                          {item.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {getQualityLabel(item.quality)} •{" "}
                          {formatFileSize(item.size)} •{" "}
                          {new Date(item.date).toLocaleDateString()}
                        </p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-slate-400 ml-2" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Input
                    ref={inputRef}
                    type="url"
                    placeholder="Paste video URL here (YouTube, Vimeo, etc.)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleFetchInfo()}
                    disabled={
                      downloadState.status === "fetching" ||
                      downloadState.status === "downloading"
                    }
                    className="text-base h-12 flex-1 border-slate-300 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm hover:shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed pr-10"
                  />
                  {url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 transform -translate-y-1/2 h-10 w-10 p-0 text-slate-400 hover:text-blue-600"
                      onClick={handleCopyUrl}
                      disabled={urlCopied}
                    >
                      {urlCopied ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
                <Button
                  onClick={handleFetchInfo}
                  disabled={
                    downloadState.status === "fetching" ||
                    downloadState.status === "downloading"
                  }
                  size="lg"
                  className="px-6 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 sm:w-auto w-full disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {downloadState.status === "fetching" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <Info className="w-4 h-4 mr-2" />
                      Get Info
                    </>
                  )}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200 text-blue-700">
                  YouTube
                </Badge>
                <Badge variant="outline" className="text-xs bg-cyan-50 border-cyan-200 text-cyan-700">
                  Vimeo
                </Badge>
                <Badge variant="outline" className="text-xs bg-teal-50 border-teal-200 text-teal-700">
                  Dailymotion
                </Badge>
                <Badge variant="outline" className="text-xs bg-slate-100 border-slate-200 text-slate-700">
                  Twitter
                </Badge>
                <Badge variant="outline" className="text-xs bg-slate-100 border-slate-200 text-slate-700">
                  TikTok
                </Badge>
                <Badge variant="outline" className="text-xs bg-slate-100 border-slate-200 text-slate-700">
                  Instagram
                </Badge>
                <Badge variant="outline" className="text-xs bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200 text-blue-700">
                  +200 more
                </Badge>
              </div>
            </div>

            {downloadState.status === "error" && (
              <Alert
                variant="destructive"
                className="border-red-200 bg-red-50/50 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
              >
                <AlertCircle className="h-5 w-5" />
                <AlertDescription className="text-red-800 font-medium">
                  {downloadState.error}
                </AlertDescription>
              </Alert>
            )}

            {videoInfo && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col sm:flex-row gap-6 p-6 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-xl border border-slate-200/50 shadow-sm hover:shadow-md transition-all duration-300">
                  {videoInfo.thumbnail && (
                    <div className="relative group">
                      <img
                        src={videoInfo.thumbnail}
                        alt={videoInfo.title}
                        className="w-full sm:w-48 h-32 object-cover rounded-lg shadow-lg group-hover:shadow-xl transition-all duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    </div>
                  )}
                  <div className="flex-1 space-y-3">
                    <h3 className="font-semibold text-lg sm:text-xl line-clamp-2 text-slate-800 leading-tight">
                      {videoInfo.title}
                    </h3>
                    <p className="text-sm text-slate-600 font-medium">
                      {videoInfo.uploader}
                    </p>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                      <div className="flex items-center gap-1">
                        <Video className="w-4 h-4" />
                        <span>{formatDuration(videoInfo.duration)}</span>
                      </div>
                      {videoInfo.estimatedSizes[selectedQuality] && (
                        <div className="flex items-center gap-1">
                          <Download className="w-4 h-4" />
                          <span>
                            ≈{" "}
                            {formatFileSize(
                              videoInfo.estimatedSizes[selectedQuality]
                            )}
                            {videoInfo.estimatedSizes[selectedQuality] >
                              500 * 1024 * 1024 && (
                              <span className="ml-2 text-amber-600 font-medium">
                                (Large file)
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                    {videoInfo.estimatedSizes[selectedQuality] >
                      500 * 1024 * 1024 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm text-amber-800">
                          ⚠️ This is a large file (
                          {formatFileSize(
                            videoInfo.estimatedSizes[selectedQuality]
                          )}
                          ). Download may take several minutes depending on your
                          connection speed.
                        </p>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMoreInfo(!showMoreInfo)}
                      className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 p-0 h-auto"
                    >
                      {showMoreInfo ? (
                        <>
                          <ChevronUp className="w-4 h-4 mr-1" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4 mr-1" />
                          Show more
                        </>
                      )}
                    </Button>
                    {showMoreInfo && (
                      <div className="p-3 bg-slate-50 rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                        <p className="text-sm text-slate-600 line-clamp-3">
                          {videoInfo.description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-slate-700">
                    Select Quality
                  </label>
                  <Select
                    value={selectedQuality}
                    onValueChange={setSelectedQuality}
                  >
                    <SelectTrigger className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {videoInfo.availableQualities.map((quality) => (
                        <SelectItem key={quality} value={quality}>
                          <div className="flex items-center justify-between w-full">
                            <span>{getQualityLabel(quality)}</span>
                            <span className="text-xs text-slate-500 ml-4">
                              {formatFileSize(
                                videoInfo.estimatedSizes[quality]
                              )}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {downloadState.status === "downloading" && (
                  <div className="space-y-3 p-4 bg-blue-50/50 rounded-lg border border-blue-200/50 animate-in fade-in duration-300">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700 font-medium">
                        {downloadState.progress < 25
                          ? "Starting download..."
                          : downloadState.progress < 50
                          ? "Downloading..."
                          : downloadState.progress < 75
                          ? "Almost there..."
                          : "Finalizing..."}
                      </span>
                      <span className="font-bold text-blue-600">
                        {downloadState.progress.toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={downloadState.progress}
                      className="h-3 bg-blue-100"
                    />
                    <div className="flex justify-center space-x-2">
                      {[25, 50, 75, 100].map((milestone) => (
                        <div
                          key={milestone}
                          className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                            downloadState.progress >= milestone
                              ? "bg-blue-500"
                              : "bg-blue-200"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 text-center">
                      {downloadState.progress < 25
                        ? "Initializing download"
                        : downloadState.progress < 50
                        ? "Transferring data"
                        : downloadState.progress < 75
                        ? "Processing content"
                        : downloadState.progress < 100
                        ? "Completing download"
                        : "Download completed!"}
                    </p>
                    {videoInfo?.estimatedSizes[selectedQuality] >
                      500 * 1024 * 1024 && (
                      <p className="text-xs text-amber-600 text-center mt-2">
                        Large file download in progress - please be patient
                      </p>
                    )}
                  </div>
                )}

                {downloadState.status === "completed" && (
                  <Alert className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <AlertDescription className="text-green-800 font-medium">
                      Download completed successfully! Check your downloads
                      folder.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleDownload}
                    disabled={downloadState.status === "downloading"}
                    size="lg"
                    className="flex-1 h-12 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {downloadState.status === "downloading" ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : downloadState.status === "completed" ? (
                      <>
                        <CheckCircle2 className="w-5 h-5 mr-2 text-green-600" />
                        Download Complete
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 mr-2" />
                        Download Video
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleReset}
                    variant="outline"
                    size="lg"
                    className="h-12 sm:w-auto w-full border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 hover:shadow-md"
                  >
                    Reset
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-md hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 group animate-in fade-in slide-in-from-left-4 duration-500 delay-800">
            <CardHeader className="pb-3">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg text-slate-800 group-hover:text-blue-700 transition-colors">
                Lightning Fast
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 leading-relaxed">
                Experience blazing-fast downloads with our optimized servers and
                advanced technology
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-md hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-4 duration-500 delay-900">
            <CardHeader className="pb-3">
              <div className="w-12 h-12 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                <Globe className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg text-slate-800 group-hover:text-cyan-700 transition-colors">
                Universal Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 leading-relaxed">
                Download from YouTube, Vimeo, TikTok, Instagram, and 200+ platforms
                worldwide
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xl bg-white/90 backdrop-blur-md hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 group animate-in fade-in slide-in-from-right-4 duration-500 delay-1000">
            <CardHeader className="pb-3">
              <div className="w-12 h-12 bg-gradient-to-r from-teal-500 to-green-500 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg text-slate-800 group-hover:text-teal-700 transition-colors">
                Privacy First
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 leading-relaxed">
                Your privacy is our priority. No data storage, complete
                anonymity, and secure processing
              </p>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-12 text-center text-slate-500 text-sm border-t border-slate-200 pt-8">
          <p>
            Developed by Anwar Patel -{" "}
            <a
              href="mailto:patelanwar647@gmail.com"
              className="text-blue-600 hover:text-blue-700"
            >
              patelanwar647@gmail.com
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}