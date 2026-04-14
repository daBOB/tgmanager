// Barrel module for the file-chunking subsystem. Splits were factored out of
// the original 311-LOC file into focused modules:
//   - file-chunk-splitter: split into chunks + per-chunk + whole-file hashing
//   - file-chunk-merger:   merge chunks back + SHA-256 integrity verification
//   - file-split-utils:    cleanup + needsSplitting threshold check
export { splitFile, getChunkFilename } from './file-chunk-splitter.js';
export type {
  SplitOptions,
  SplitProgress,
  SplitResult
} from './file-chunk-splitter.js';
export { mergeChunks } from './file-chunk-merger.js';
export { cleanupChunks, needsSplitting } from './file-split-utils.js';
