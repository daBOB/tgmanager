// src/commands/upload-storage-progress-reporter.ts
// Factory helpers for cli-progress bars used during upload operations
import cliProgress from 'cli-progress';

/** Progress bar for the chunk-splitting phase */
export function createSplitProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    { format: 'Splitting |{bar}| {percentage}% | Chunk {currentChunk}/{totalChunks}' },
    cliProgress.Presets.shades_classic
  );
}

/** Progress bar for the multi-chunk upload phase */
export function createChunkUploadProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    { format: 'Uploading |{bar}| {percentage}% | Chunk {chunkIndex}/{totalChunks}' },
    cliProgress.Presets.shades_classic
  );
}

/** Progress bar for single direct-upload */
export function createDirectUploadProgressBar(): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    { format: 'Uploading |{bar}| {percentage}%' },
    cliProgress.Presets.shades_classic
  );
}
